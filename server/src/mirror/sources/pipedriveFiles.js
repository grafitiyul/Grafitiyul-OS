// Live Pipedrive FILES mirroring — poll-based, because Pipedrive has no file
// webhook object (verified against the v1 webhook object list).
//
// TRANSPORT: GET /recents?since_timestamp=<cursor>&items=file — ONE request per
// tick when quiet, designed by Pipedrive for exactly this. The cursor is the max
// update_time OBSERVED (source clock, never ours). No rescans: the initial
// position was set by the census/import; polling only ever moves forward.
//
// POLICY C (owner, 2026-07-31), applied identically to the batch import:
//   * email attachments (mail_message_id) are dropped AT THE SOURCE — the Gmail
//     integration owns them in GOS, and persisting an event per attachment
//     would garbage the buffer for no destination write;
//   * active (open/won) deal files: body → R2 + DealFile + crosswalk, atomic;
//   * closed-deal files: metadata-only crosswalk (payload keeps everything);
//   * files with no deal: metadata-only crosswalk (traceable, no entity).

import crypto from 'node:crypto';
import * as r2 from '../../migration/r2.js';
import { atomicCreate } from '../creators.js';

const token = () => String(process.env.PIPEDRIVE_API_TOKEN || '').trim();
const domain = () => String(process.env.PIPEDRIVE_COMPANY_DOMAIN || '').trim();

async function pd(path) {
  const res = await fetch(`https://${domain()}.pipedrive.com/api/v1${path}${path.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(token())}`);
  if (!res.ok) throw new Error(`pipedrive ${path.split('?')[0]} → ${res.status}`);
  return res.json();
}

export function pipedriveFilesConfigured() {
  return !!(token() && domain());
}

/** Poll source for the worker — same fetchChanges contract as the Airtable ones. */
export function pipedriveFilesSource() {
  return {
    async fetchChanges(cursor) {
      // First tick with no cursor starts NOW: history was handled by the batch
      // import, and walking 180k rows from a poller is exactly the rescan the
      // brief forbids.
      const since = cursor || new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
      const page = await pd(`/recents?since_timestamp=${encodeURIComponent(since)}&items=file&limit=100`);
      let maxSeen = cursor || since;
      const records = [];
      for (const r of page.data || []) {
        const f = r.data;
        if (!f?.id) continue;
        if (f.update_time && String(f.update_time) > String(maxSeen)) maxSeen = String(f.update_time);
        // Email attachments never become events at all — Gmail owns them.
        if (f.mail_message_id) continue;
        records.push({
          externalId: String(f.id),
          version: f.update_time || null,
          payload: { id: f.id, current: f },
        });
      }
      return { records, nextCursor: maxSeen };
    },
  };
}

/** The file adapter — createGos-only in practice (files are immutable blobs). */
export function fileAdapter() {
  return {
    sourceType: 'file',
    async normalize(payload) {
      const c = payload?.current ?? payload;
      if (!c || c.active_flag === false) return { sourceDeleted: true, fields: {} };
      return { fields: {} };
    },
    async loadGos(db, id) {
      return db.dealFile.findUnique({ where: { id }, select: { id: true } }).catch(() => ({ id }));
    },
    async applyGos() { /* a stored file is immutable — nothing to merge */ },
    describe: (gos) => ({ label: `file ${gos?.id ?? ''}` }),

    async createGos(db, normalized, row) {
      const f = row.rawPayload?.current ?? {};
      if (f.mail_message_id) {
        return { terminal: true, reason: 'email_attachment_gmail_owned', detail: `file ${row.externalId} is an email attachment — the Gmail integration owns it in GOS` };
      }
      const dealId = f.deal_id ?? null;
      const dealLink = dealId != null ? await db.legacyRecord.findUnique({
        where: { sourceSystem_sourceType_sourceId: { sourceSystem: 'pipedrive', sourceType: 'deal', sourceId: String(dealId) } },
        select: { entityId: true },
      }) : null;
      const gosDeal = dealLink?.entityId ? await db.deal.findUnique({ where: { id: dealLink.entityId }, select: { id: true, status: true } }) : null;

      // Metadata-only cases: no deal, deal unknown, or closed deal (policy C).
      const metadataOnly = !gosDeal || !['open', 'won'].includes(gosDeal.status);
      if (metadataOnly) {
        // Crosswalk-only row (no GOS entity) — the unique key IS the idempotency,
        // so skipDuplicates makes redelivery and retry free. atomicCreate is not
        // used here because the crosswalk row is the only write.
        await db.legacyRecord.createMany({
          data: [{
            sourceSystem: 'pipedrive', sourceType: 'file', sourceId: String(row.externalId),
            entityType: null, entityId: null, importBatchId: 'mirror-live',
            payload: { ...f, gosDealId: gosDeal?.id ?? null, policy: gosDeal ? 'metadata_only_closed_deal' : 'metadata_only_no_deal' },
          }],
          skipDuplicates: true,
        });
        return { entityType: null, entityId: `file:${row.externalId}`, fieldsWritten: { metadataOnly: true } };
      }

      // Active deal → copy the body.
      const dl = await fetch(`https://${domain()}.pipedrive.com/api/v1/files/${row.externalId}/download?api_token=${encodeURIComponent(token())}`, { redirect: 'follow' });
      if (!dl.ok) {
        return { reason: 'file_download_failed', detail: `file ${row.externalId} download → ${dl.status} — deferred for retry` };
      }
      const body = Buffer.from(await dl.arrayBuffer());
      const safeName = String(f.file_name || f.name || `file-${row.externalId}`).replace(/[^\w.\-֐-׿ ]+/g, '_').slice(0, 120);
      const r2Key = `deal-files/${gosDeal.id}/pd-${row.externalId}-${safeName}`;
      await r2.putObject({ key: r2Key, body, contentType: f.file_type || 'application/octet-stream' });

      return atomicCreate(db, {
        sourceType: 'file',
        sourceId: row.externalId,
        writes: async (tx) => {
          const id = crypto.randomUUID();
          await tx.dealFile.create({
            data: {
              id, dealId: gosDeal.id, r2Key, bucket: r2.bucket(),
              filename: f.file_name || f.name || `file-${row.externalId}`,
              mimeType: f.file_type || 'application/octet-stream',
              sizeBytes: body.length,
              uploadedById: null,
            },
          });
          return { entityType: 'DealFile', entityId: id, dealId: gosDeal.id };
        },
      });
    },
  };
}

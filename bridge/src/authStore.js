// Postgres-backed Baileys AuthenticationState — verbatim port of the proven
// Challenge System store, scoped by accountId instead of connectionId.
//
// Mirrors useMultiFileAuthState() but persists into the WhatsAppSession table
// instead of disk. Two reasons we don't use the file-based helper:
//   1. Railway volumes are per-service; a redeploy that recreates the bridge
//      container would lose the session and force a re-pair.
//   2. Centralised persistence lets the admin wipe credentials from the UI
//      without shelling into the container.
//
// Serialisation uses Baileys' standard BufferJSON replacer/reviver so binary
// signal keys round-trip through Postgres JSONB losslessly. kind matches the
// file variant's "type", keyId matches its "id".

import pino from 'pino';
import { config } from './config.js';
import { getBaileys } from './baileysLib.js';

const log = pino({ level: config.logLevel, name: 'auth-store' });

const CREDS_KIND = 'creds';
const CREDS_KEY_ID = 'singleton';

// Round-trip through BufferJSON so the stored value is a pure-JSON tree
// (Buffers become { type: 'Buffer', data: base64 } markers the reviver
// restores on read).
function encode(value) {
  return JSON.parse(JSON.stringify(value, getBaileys().BufferJSON.replacer));
}

function decode(json) {
  return JSON.parse(JSON.stringify(json), getBaileys().BufferJSON.reviver);
}

// Returns { state, saveCreds, clear, hasCreds, keyCount }.
// `clear` wipes ALL auth rows for THIS account (creds + every signal key) —
// only the explicit admin sign-out / hard-reset paths call it. Scoped per
// account so wiping one number can never touch the other bridge's session.
export async function makePostgresAuthState(prisma, accountId) {
  const credsRow = await prisma.whatsAppSession.findUnique({
    where: { accountId_kind_keyId: { accountId, kind: CREDS_KIND, keyId: CREDS_KEY_ID } },
  });
  const creds = credsRow ? decode(credsRow.data) : getBaileys().initAuthCreds();

  // Count signal-key rows by kind so the boot log answers "did creds + keys
  // actually persist?" at a glance. One indexed query, no sensitive data.
  const counts = await prisma.whatsAppSession.groupBy({
    by: ['kind'],
    where: { accountId },
    _count: { _all: true },
  });
  const keyCount = counts.reduce(
    (sum, row) => sum + (row.kind === CREDS_KIND ? 0 : row._count._all),
    0,
  );
  log.info(
    { accountId, hasCreds: !!credsRow, keyCount, byKind: counts.map((c) => ({ kind: c.kind, count: c._count._all })) },
    'loaded auth state from postgres',
  );

  return {
    hasCreds: !!credsRow,
    keyCount,
    state: {
      creds,
      keys: {
        // Baileys requests N keys of one type at once — one indexed query.
        // Missing keys must simply be absent from the result object.
        get: async (type, ids) => {
          if (ids.length === 0) return {};
          const rows = await prisma.whatsAppSession.findMany({
            where: { accountId, kind: type, keyId: { in: ids } },
            select: { keyId: true, data: true },
          });
          const out = {};
          for (const row of rows) {
            const value = decode(row.data);
            // app-state-sync-key must be revived as the protobuf message
            // class, not a plain object — the documented Baileys pattern.
            // v7 stripped .fromObject(); .create() accepts the same shape
            // (fields are already Buffers thanks to the BufferJSON reviver).
            if (type === 'app-state-sync-key' && value) {
              out[row.keyId] = getBaileys().proto.Message.AppStateSyncKeyData.create(value);
            } else {
              out[row.keyId] = value;
            }
          }
          return out;
        },

        // Baileys passes {[type]: {[id]: data | null}}; null means "delete
        // this key". Translate to upserts + targeted deletes in a single
        // transaction so a partial failure can't leave auth half-written.
        set: async (data) => {
          const upserts = [];
          const deletes = [];
          for (const kind of Object.keys(data)) {
            const inner = data[kind];
            if (!inner) continue;
            for (const keyId of Object.keys(inner)) {
              const value = inner[keyId];
              if (value === null || value === undefined) {
                deletes.push({ kind, keyId });
                continue;
              }
              upserts.push(
                prisma.whatsAppSession.upsert({
                  where: { accountId_kind_keyId: { accountId, kind, keyId } },
                  create: { accountId, kind, keyId, data: encode(value) },
                  update: { data: encode(value) },
                }),
              );
            }
          }
          if (upserts.length > 0 || deletes.length > 0) {
            await prisma.$transaction([
              ...upserts,
              ...deletes.map((d) =>
                prisma.whatsAppSession.deleteMany({
                  where: { accountId, kind: d.kind, keyId: d.keyId },
                }),
              ),
            ]);
          }
        },
      },
    },

    saveCreds: async () => {
      await prisma.whatsAppSession.upsert({
        where: { accountId_kind_keyId: { accountId, kind: CREDS_KIND, keyId: CREDS_KEY_ID } },
        create: { accountId, kind: CREDS_KIND, keyId: CREDS_KEY_ID, data: encode(creds) },
        update: { data: encode(creds) },
      });
      log.debug({ accountId }, 'creds.update saved');
    },

    clear: async () => {
      // Explicit wipe only (admin sign-out / hard-reset). The loggedOut
      // close handler intentionally does NOT call this — the same protocol
      // code fires on benign deploy-overlap kicks, and auto-wiping there
      // once destroyed a long-lived session in the Challenge System.
      const { count } = await prisma.whatsAppSession.deleteMany({ where: { accountId } });
      log.warn({ deletedRows: count, accountId }, 'auth state wiped');
    },
  };
}

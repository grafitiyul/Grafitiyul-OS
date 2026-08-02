import { parseDocumentReferences } from '../collectionEvidence.js';

// Recover "פתח מסמך" links from the ORIGINAL office notes.
//
// doc/search — the census's only bulk read — never returns doc_url, so every one
// of the reconstructed document links landed without a viewer URL and could not
// be opened. But the office often pasted iCount's own link into the note at the
// time ("המסמך נוצר בהצלחה מספר 38460 | https://app.icount.co.il/hash/p_print.php?code=…"),
// and those notes are still there, untouched.
//
// This reads them and attaches the URL to the matching document link. It is the
// free half of the fix: no API call, and the remaining documents resolve one at
// a time through doc/get_doc_url when an operator actually clicks.
//
// STRICT: a URL is only attached when the SAME note also states the document
// number it belongs to. A link found next to a different number would open the
// wrong document, which is worse than not opening at all.
//
// Idempotent (skips rows that already have a URL) and read-only toward iCount.

export async function backfillIcountDocUrls(client, { log = console, dryRun = false, limit = 0 } = {}) {
  const targets = await client.icountDocument.findMany({
    where: { docUrl: null, docnum: { not: null } },
    select: { id: true, dealId: true, doctype: true, docnum: true },
  });
  if (!targets.length) return { scanned: 0, matched: 0, updated: 0 };

  const byDeal = new Map();
  for (const t of targets) {
    if (!byDeal.has(t.dealId)) byDeal.set(t.dealId, []);
    byDeal.get(t.dealId).push(t);
  }

  // Only notes that actually contain an iCount link are worth parsing.
  const notes = await client.timelineEntry.findMany({
    where: {
      subjectType: 'deal',
      subjectId: { in: [...byDeal.keys()] },
      deletedAt: null,
      body: { contains: 'icount.co.il' },
    },
    select: { subjectId: true, body: true },
  });

  // docnum → url, per deal. Built from references parsed out of ONE note at a
  // time, so a number and a link only pair up when they were written together.
  const urlByDealDoc = new Map();
  for (const n of notes) {
    const refs = parseDocumentReferences(n.body);
    const url = refs.find((r) => r.url)?.url;
    if (!url) continue;
    for (const r of refs) {
      if (!r.docnum) continue;
      const key = `${n.subjectId}:${r.docnum}`;
      if (!urlByDealDoc.has(key)) urlByDealDoc.set(key, url);
    }
  }

  const updates = [];
  for (const t of targets) {
    const url = urlByDealDoc.get(`${t.dealId}:${t.docnum}`);
    if (url) updates.push({ id: t.id, url });
  }

  if (dryRun || !updates.length) {
    log.log?.(`[doc-urls] ${targets.length} links without a URL · ${updates.length} recoverable from notes${dryRun ? ' (dry run)' : ''}`);
    return { scanned: targets.length, matched: updates.length, updated: 0 };
  }

  const batch = limit ? updates.slice(0, limit) : updates;
  let updated = 0;
  const CHUNK = 200;
  for (let i = 0; i < batch.length; i += CHUNK) {
    await client.$transaction(
      batch.slice(i, i + CHUNK).map((u) => client.icountDocument.update({ where: { id: u.id }, data: { docUrl: u.url } })),
    );
    updated += Math.min(CHUNK, batch.length - i);
  }
  log.log?.(`[doc-urls] attached ${updated} viewer URLs recovered from the original notes (of ${targets.length} links missing one)`);
  return { scanned: targets.length, matched: updates.length, updated };
}

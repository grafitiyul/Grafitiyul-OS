// Pipedrive files CENSUS — metadata only, no bodies.
//
//   railway run --service Grafitiyul-OS node server/scripts/migration/files-census.mjs
//
// One bulk /files walk (~110 requests for ~10k files at 100/page), persisted to
// R2 as a dated census the importer consumes. Bodies are NOT downloaded here —
// that is the importer's job, under its own ceiling.
import * as r2 from '../../src/migration/r2.js';

const token = String(process.env.PIPEDRIVE_API_TOKEN || '').trim();
const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || '').trim();
if (!token || !domain) { console.error('missing PIPEDRIVE_API_TOKEN / PIPEDRIVE_COMPANY_DOMAIN'); process.exit(1); }
const CEILING = 2200; // full walk of ~180k rows at 100/page ≈ 1,809 + retry headroom
let used = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Throttled + 429-aware. Pipedrive's burst window is 40 req / 2s; pacing at ~4/s
// stays far inside it AND leaves headroom for Make's scenarios, which share the
// company budget — starving them would break live lead intake.
async function pd(path) {
  for (let attempt = 1; ; attempt += 1) {
    if (++used > CEILING) throw new Error(`census ceiling ${CEILING} reached`);
    const res = await fetch(`https://${domain}.pipedrive.com/api/v1${path}${path.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(token)}`);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      if (retryAfter > 300) {
        // DAILY budget exhausted, not a burst. Sleeping here is pointless and the
        // checkpoint makes resumption free — persist and exit resumably.
        await r2.putObject({ key: 'files-census/checkpoint.json', body: JSON.stringify({ files, nextStart: start }), contentType: 'application/json' });
        console.log(`daily Pipedrive budget exhausted (retry-after ${retryAfter}s) — checkpointed ${files.length} files at start=${start}; re-run after reset`);
        process.exit(3);
      }
      if (attempt > 8) throw new Error(`${path} → 429 after ${attempt} attempts`);
      const wait = retryAfter * 1000 || 15_000 * attempt;
      console.log(`  429 — backing off ${Math.round(wait / 1000)}s (attempt ${attempt})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    await sleep(250);
    return res.json();
  }
}

// Resume from the last checkpoint so a mid-walk failure never re-spends the
// whole walk again — the first two attempts burned ~1,600 requests proving this.
const files = [];
let start = 0;
try {
  const ck = JSON.parse(await r2.getObjectText('files-census/checkpoint.json'));
  files.push(...ck.files);
  start = ck.nextStart;
  console.log(`resuming from checkpoint: ${files.length} files, start=${start}`);
} catch { /* no checkpoint — fresh walk */ }

let sinceCheckpoint = 0;
for (;;) {
  const page = await pd(`/files?limit=100&start=${start}&sort=id ASC`);
  for (const f of page.data || []) {
    files.push({
      id: f.id,
      deal_id: f.deal_id ?? null,
      person_id: f.person_id ?? null,
      org_id: f.org_id ?? null,
      file_name: f.file_name ?? f.name ?? null,
      file_type: f.file_type ?? null,
      file_size: f.file_size ?? null,
      mime: f.mime_type ?? null,
      add_time: f.add_time ?? null,
      update_time: f.update_time ?? null,
      user_id: f.user_id ?? null,
      remote_location: f.remote_location ?? null, // 'googledrive' etc. — link-only files
      mail_message_id: f.mail_message_id ?? null,  // set → email attachment (Gmail already covers these in GOS)
      activity_id: f.activity_id ?? null,
      inline_flag: f.inline_flag ?? null,
      url: f.url ?? null,
    });
  }
  const more = page.additional_data?.pagination?.more_items_in_collection;
  if (!more) break;
  start = page.additional_data.pagination.next_start;
  sinceCheckpoint += 1;
  if (sinceCheckpoint >= 100) {
    await r2.putObject({ key: 'files-census/checkpoint.json', body: JSON.stringify({ files, nextStart: start }), contentType: 'application/json' });
    sinceCheckpoint = 0;
    console.log(`  checkpoint @ ${files.length} files (${used} requests this run)`);
  }
}

const censusId = `files-census-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
await r2.putObject({ key: `files-census/${censusId}.json`, body: JSON.stringify({ censusId, at: new Date().toISOString(), requests: used, files }), contentType: 'application/json' });

const byKind = {};
for (const f of files) {
  const k = f.mail_message_id ? 'email_attachment' : f.deal_id ? 'deal' : f.person_id ? 'person' : f.org_id ? 'org' : 'unattached';
  byKind[k] = (byKind[k] || 0) + 1;
}
const remote = files.filter((f) => f.remote_location && f.remote_location !== 'pipedrive').length;
console.log(`\ncensus ${censusId}`);
console.log(`  files: ${files.length} · requests used: ${used}/${CEILING}`);
console.log(`  attachment: ${JSON.stringify(byKind)}`);
console.log(`  remote-linked (Drive etc., link-only by nature): ${remote}`);
console.log(`  total bytes (pipedrive-hosted): ${files.filter((f) => !f.remote_location || f.remote_location === 'pipedrive').reduce((n, f) => n + (f.file_size || 0), 0)}`);
console.log(`\nstored → files-census/${censusId}.json`);

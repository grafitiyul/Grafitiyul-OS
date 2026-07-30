// Inspect / create the ONE Pipedrive webhook subscription the mirror needs.
//
//   railway run --service Grafitiyul-OS node server/scripts/mirror/pipedrive-webhook.mjs [--create]
//
// SCOPE, and it is deliberately narrow: this script reads the webhook list and may
// create ONE webhook subscription. It has no code path that reads, writes or
// deletes any business record in Pipedrive, and none that deletes a webhook.
//
// Secrets are never printed. The auth password is the Railway secret; this script
// only ever reports whether it matches, never its value.
const token = String(process.env.PIPEDRIVE_API_TOKEN || '').trim();
const secret = String(process.env.MIRROR_PIPEDRIVE_WEBHOOK_SECRET || '').trim();
const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || '').trim();
const CREATE = process.argv.includes('--create');

if (!token) { console.error('PIPEDRIVE_API_TOKEN missing'); process.exit(1); }
if (!secret) { console.error('MIRROR_PIPEDRIVE_WEBHOOK_SECRET missing — set it before creating the webhook'); process.exit(1); }
if (!domain) { console.error('PIPEDRIVE_COMPANY_DOMAIN missing'); process.exit(1); }

const BASE = `https://${domain}.pipedrive.com/api/v1`;
const ENDPOINT = 'https://app.grafitiyul.co.il/api/mirror/pipedrive';
const AUTH_USER = 'gos-mirror';
// The objects the mirror has adapters for. Pipedrive's own wildcard covers these
// plus others; the route acknowledges and drops anything unmirrored by design.
const WANTED_OBJECTS = ['deal', 'person', 'organization', 'activity', 'note'];

const redact = (s) => String(s ?? '').split(token).join('***TOKEN***').split(secret).join('***SECRET***');

async function pd(path, init = {}) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = json?.error || json?.message || text.slice(0, 200);
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${redact(msg)}`);
  }
  return json;
}

// ── 1) read the existing subscriptions ───────────────────────────────────────
const list = await pd('/webhooks');
const hooks = list?.data || [];
console.log(`existing webhook subscriptions: ${hooks.length}`);
for (const h of hooks) {
  const mine = String(h.subscription_url || '') === ENDPOINT;
  console.log(`  #${h.id}  ${h.event_action}.${h.event_object}  → ${redact(h.subscription_url)}`);
  console.log(`        active=${h.is_active ?? h.active_flag ?? '?'}  owner=${h.owner_id ?? '?'}  added=${h.add_time ?? '?'}${mine ? '   ← OUR ENDPOINT' : ''}`);
  if (h.last_delivery_time || h.last_http_status) {
    console.log(`        last delivery ${h.last_delivery_time ?? '—'} status ${h.last_http_status ?? '—'}`);
  }
}

// ── 2) is one already usable? ────────────────────────────────────────────────
const ours = hooks.filter((h) => String(h.subscription_url || '') === ENDPOINT);
const coversAll = (h) => {
  const obj = String(h.event_object || '');
  const act = String(h.event_action || '');
  return (obj === '*' || obj === 'all') && (act === '*' || act === 'all');
};
const reusable = ours.filter((h) => (h.is_active ?? h.active_flag ?? 1) && coversAll(h));
const perObject = new Map();
for (const h of ours) {
  const obj = String(h.event_object || '');
  if (WANTED_OBJECTS.includes(obj)) perObject.set(obj, h);
}

console.log('');
if (reusable.length) {
  console.log(`REUSE: webhook #${reusable[0].id} already points at our endpoint with wildcard coverage.`);
  console.log(`  covers: ${WANTED_OBJECTS.join(', ')} (via *.*), plus other objects the route safely ignores.`);
  if (reusable.length > 1) console.log(`  NOTE: ${reusable.length} wildcard hooks exist for this endpoint — duplicates would double-deliver. Worth pruning manually (this script never deletes).`);
  console.log('\nNothing to create. Note: an existing hook\'s auth password cannot be read back from the API,');
  console.log('so if it predates the current MIRROR_PIPEDRIVE_WEBHOOK_SECRET the capture test will 401.');
  console.log('If the test 401s, that is the reason — recreate the subscription rather than guessing.');
  process.exit(0);
}
if (perObject.size) {
  console.log(`PARTIAL: our endpoint has per-object hooks for [${[...perObject.keys()].join(', ')}].`);
  const missing = WANTED_OBJECTS.filter((o) => !perObject.has(o));
  if (!missing.length) { console.log('  All five objects covered — REUSE, nothing to create.'); process.exit(0); }
  console.log(`  Missing: ${missing.join(', ')}. Creating one wildcard hook would DOUBLE-deliver the covered objects.`);
  console.log('  Refusing to act automatically — this needs a human decision. Nothing was created.');
  process.exit(3);
}

console.log('CREATE: no webhook points at our endpoint.');
if (!CREATE) {
  console.log('\nPLAN only — nothing created. Re-run with --create.');
  console.log(`Would create ONE subscription:`);
  console.log(`  url        ${ENDPOINT}`);
  console.log(`  event      *.*  (all actions, all objects — one hook covers ${WANTED_OBJECTS.join('/')})`);
  console.log(`  auth user  ${AUTH_USER}`);
  console.log(`  auth pass  [the Railway MIRROR_PIPEDRIVE_WEBHOOK_SECRET]`);
  process.exit(0);
}

// ── 3) create exactly ONE ────────────────────────────────────────────────────
// One wildcard subscription rather than five per-object ones: the owner asked for a
// single webhook, Pipedrive bills no differently, and the route already drops
// unmirrored objects with a 200 by design.
const created = await pd('/webhooks', {
  method: 'POST',
  body: JSON.stringify({
    subscription_url: ENDPOINT,
    event_action: '*',
    event_object: '*',
    http_auth_user: AUTH_USER,
    http_auth_password: secret,
    version: '1.0',
  }),
});
const h = created?.data;
if (!h?.id) { console.error('create returned no id'); process.exit(2); }
console.log(`\n✓ created webhook #${h.id}  ${h.event_action}.${h.event_object} → ${redact(h.subscription_url)}`);

// ── 4) verify by re-reading, not by trusting the create response ─────────────
const after = (await pd('/webhooks'))?.data || [];
const mineNow = after.filter((x) => String(x.subscription_url || '') === ENDPOINT);
console.log(`\nre-read: ${mineNow.length} subscription(s) for our endpoint`);
for (const x of mineNow) console.log(`  #${x.id}  ${x.event_action}.${x.event_object}  active=${x.is_active ?? x.active_flag ?? '?'}`);
if (mineNow.length !== 1) {
  console.error(`\n⚠ expected exactly 1, found ${mineNow.length} — duplicates double-deliver. Prune manually.`);
  process.exit(2);
}
console.log(`\ntotal webhooks in the account: ${after.length} (was ${hooks.length}) — one added, none modified, none deleted.`);

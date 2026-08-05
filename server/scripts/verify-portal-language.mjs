// Guide Portal — live language verification.
//
// Walks EVERY portal endpoint over the real HTTP API with a real portal token,
// for a Hebrew guide and for an English guide, and reports what each of them
// actually receives. This is the check that the two experiences are internally
// consistent — it exercises the deployed server, not a mock.
//
// Read-only: every request is a GET.
//
//   railway run node server/scripts/verify-portal-language.mjs
//   node server/scripts/verify-portal-language.mjs --origin=https://app.grafitiyul.co.il
//
// Needs DATABASE_URL only to look up the two guides' tokens; everything else
// goes over HTTP exactly as a phone would.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const originArg = process.argv.find((a) => a.startsWith('--origin='));
const ORIGIN = originArg ? originArg.split('=')[1] : (process.env.GOS_ORIGIN || 'https://app.grafitiyul.co.il');

// Latin vs Hebrew detection — used only to CLASSIFY what came back, never to
// change behaviour.
const HEBREW = /[֐-׿]/;
const has = (v) => typeof v === 'string' && v.trim() !== '';

async function get(token, path) {
  const url = `${ORIGIN}/api/portal/${encodeURIComponent(token)}${path}`;
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-store' } });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: await res.json() };
}

// Collect the business strings a screen actually renders, with their source.
function collect(label, values) {
  return values.filter((v) => has(v.value)).map((v) => ({ screen: label, ...v }));
}

async function walk(token) {
  const seen = [];
  const push = (rows) => seen.push(...rows);

  const home = await get(token, '/home');
  const language = home.body?.language ?? null;
  push(collect('Header', [{ field: 'person.displayName', value: home.body?.person?.displayName }]));

  const upcoming = await get(token, '/tours/upcoming');
  const past = await get(token, '/tours/past');
  for (const [name, r] of [['Upcoming tours', upcoming], ['Past tours', past]]) {
    for (const t of (r.body?.tours || []).slice(0, 5)) {
      push(collect(name, [{ field: 'variantName', value: t.variantName }]));
    }
  }

  // Tour detail — prefer an upcoming tour, else the most recent past one.
  const sample = (upcoming.body?.tours || [])[0] || (past.body?.tours || [])[0] || null;
  if (sample) {
    const detail = await get(token, `/tours/${sample.id}/detail`);
    const d = detail.body || {};
    push(
      collect('Tour detail', [
        { field: 'variantName', value: d.variantName },
        { field: 'locationName', value: d.locationName },
        ...(d.components || []).map((c) => ({ field: 'component.name', value: c.name })),
        ...(d.workshopLocations || []).flatMap((w) => [
          { field: 'workshop.name', value: w.name },
          { field: 'workshopLocation.name', value: w.location?.name },
          { field: 'workshopLocation.address', value: w.location?.address },
          { field: 'workshopLocation.instructions', value: w.location?.instructions },
        ]),
        ...(d.team || []).map((m) => ({ field: 'team.displayName', value: m.displayName })),
        ...(d.participantBreakdown?.byProduct || []).flatMap((p) => [
          { field: 'breakdown.product', value: p.label },
          ...(p.ticketTypes || []).map((tt) => ({ field: 'breakdown.ticketType', value: tt.label })),
        ]),
      ]),
    );
  }

  const procedures = await get(token, '');
  push(
    collect('Procedures', (procedures.body?.tasks || []).map((t) => ({ field: 'task.title', value: t.title }))),
  );

  const training = await get(token, '/training');
  for (const t of training.body?.tours || []) {
    push(collect('Training', [{ field: 'tour.title', value: t.title }]));
    for (const st of (t.stations || []).slice(0, 3)) {
      push(collect('Training', [{ field: 'station.title', value: st.title }]));
    }
  }
  const firstStation = (training.body?.tours || [])[0]?.stations?.[0];
  if (firstStation) {
    const station = await get(token, `/training/stations/${firstStation.id}`);
    const s = station.body || {};
    push(
      collect('Training station', [
        { field: 'station.title', value: s.title },
        ...(s.parts || []).slice(0, 3).map((p) => ({ field: 'part.title', value: p.title })),
        ...(s.media || []).slice(0, 3).map((m) => ({ field: 'media.title', value: m.title })),
      ]),
    );
  }

  const pay = await get(token, '/pay');
  for (const e of (pay.body?.entries || []).slice(0, 5)) {
    push(collect('Pay', [{ field: 'activityTitle', value: e.activityTitle }]));
    for (const l of e.lines || []) push(collect('Pay', [{ field: 'line.name', value: l.name }]));
  }

  const profile = await get(token, '/profile');
  push(collect('Profile', [{ field: 'displayName', value: profile.body?.displayName }]));

  return {
    language,
    statuses: {
      home: home.status,
      upcoming: upcoming.status,
      past: past.status,
      procedures: procedures.status,
      training: training.status,
      pay: pay.status,
      profile: profile.status,
    },
    values: seen,
  };
}

async function main() {
  const people = await prisma.personRef.findMany({
    where: { portalEnabled: true, status: { not: 'blocked' } },
    select: { displayName: true, portalToken: true, profile: { select: { preferredLanguage: true } } },
  });
  const withToken = people.filter((p) => p.portalToken);
  const en = withToken.find((p) => p.profile?.preferredLanguage === 'en');
  const he = withToken.find((p) => p.profile?.preferredLanguage !== 'en');
  if (!en || !he) {
    console.error('Need one English and one Hebrew guide with a portal token.');
    process.exit(1);
  }

  console.log(`\nGUIDE PORTAL — LIVE LANGUAGE VERIFICATION  (${ORIGIN})`);
  console.log('='.repeat(60));

  for (const person of [he, en]) {
    const r = await walk(person.portalToken);
    const stored = person.profile?.preferredLanguage || '(none)';
    console.log(`\n▶ ${person.displayName}  stored=${stored}  resolved=${r.language}`);
    const bad = Object.entries(r.statuses).filter(([, s]) => s >= 500);
    console.log(
      `  endpoints: ${Object.entries(r.statuses).map(([k, v]) => `${k}=${v}`).join(' ')}` +
        (bad.length ? '   ⚠ SERVER ERRORS' : ''),
    );

    const hebrew = r.values.filter((v) => HEBREW.test(v.value));
    const latin = r.values.filter((v) => !HEBREW.test(v.value));
    console.log(`  business values seen: ${r.values.length}  (latin ${latin.length} / hebrew ${hebrew.length})`);

    if (r.language === 'en') {
      // For the English guide, every Hebrew value left is a CONTENT gap. List
      // them grouped, so the output doubles as the remaining worklist.
      const byField = new Map();
      for (const v of hebrew) {
        const key = `${v.screen} · ${v.field}`;
        if (!byField.has(key)) byField.set(key, new Set());
        byField.get(key).add(v.value);
      }
      if (!byField.size) {
        console.log('  ✓ no Hebrew business values remain');
      } else {
        console.log('  Hebrew values still shown (missing English CONTENT, not code):');
        for (const [key, vals] of [...byField.entries()].sort()) {
          console.log(`    - ${key}: ${[...vals].slice(0, 3).map((v) => `"${v}"`).join(', ')}${vals.size > 3 ? ` …+${vals.size - 3}` : ''}`);
        }
      }
    }
    if (process.argv.includes('--values')) {
      const byField = new Map();
      for (const v of r.values) {
        const key = `${v.screen} · ${v.field}`;
        if (!byField.has(key)) byField.set(key, new Set());
        byField.get(key).add(v.value);
      }
      console.log('  everything this guide sees:');
      for (const [key, vals] of [...byField.entries()].sort()) {
        console.log(`    ${key}: ${[...vals].slice(0, 4).map((v) => `"${v}"`).join(', ')}`);
      }
    }
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

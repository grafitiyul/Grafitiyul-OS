// Live recruitment-export integration.
//
// The recruitment system (grafitiyul-recruitment) exposes read-only export
// endpoints. This module fetches them and exposes getRecruitmentSnapshot(),
// consumed by people.js syncFromUpstream() to (a) mirror TRAINEE identity and
// (b) reconcile the trainee roster. The old /api/recruitment/* admin proxy
// endpoints were removed in Step 7 (dead — never called by any client); the
// snapshot fetch below is the only remaining, load-bearing surface.
//
// Contract with upstream (per Slice 8 integration spec):
//   GET  ${RECRUITMENT_API_BASE_URL}/api/export/guides
//        → array of guide objects (or { guides|data|items: [...] })
//          Fields used: id / externalPersonId / guideId / _id (first non-empty),
//                       fullName / displayName / name,
//                       email,
//                       phone / mobile / phoneNumber.
//
// Constraints:
//   * No caching (respect the project-wide no-store policy). Every request
//     does a live upstream fetch.
//   * No transformation beyond the field projection above — we never
//     synthesize data, compute new fields, or merge rows.
//   * The upstream export layer is owned by the recruitment team and
//     never modified from here.

const UPSTREAM_TIMEOUT_MS = 10_000;

function baseUrl() {
  const v = process.env.RECRUITMENT_API_BASE_URL;
  if (!v || !String(v).trim()) {
    const err = new Error('recruitment_base_url_not_configured');
    err.statusCode = 503;
    err.detail =
      'Set RECRUITMENT_API_BASE_URL env var to the grafitiyul-recruitment origin ' +
      '(e.g. https://grafitiyul-recruitment.up.railway.app). Without it, ' +
      '/api/recruitment/* cannot fetch real data.';
    throw err;
  }
  return String(v).trim().replace(/\/+$/, '');
}

function internalSecret() {
  const v = process.env.INTERNAL_EXPORT_SECRET;
  if (!v || !String(v).trim()) {
    const err = new Error('internal_export_secret_not_configured');
    err.statusCode = 503;
    err.detail =
      'Set INTERNAL_EXPORT_SECRET env var to the shared secret configured ' +
      'on grafitiyul-recruitment. The recruitment export endpoints require ' +
      'the x-internal-export-secret header for server-to-server auth.';
    throw err;
  }
  return String(v).trim();
}

async function fetchUpstream(path, { allowNotFound = false } = {}) {
  const url = `${baseUrl()}${path}`;
  const secret = internalSecret();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      signal: ctl.signal,
      headers: {
        Accept: 'application/json',
        'x-internal-export-secret': secret,
      },
    });
  } catch (e) {
    const err = new Error('recruitment_upstream_unreachable');
    err.statusCode = 502;
    err.detail = `GET ${url} failed: ${e?.name === 'AbortError' ? `timeout after ${UPSTREAM_TIMEOUT_MS}ms` : e?.message}`;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // 404 is the signal we get during the brief deploy window where
    // recruitment hasn't yet shipped the new /people endpoint. The
    // caller can pass `allowNotFound: true` to detect this and fall
    // back to a legacy endpoint without surfacing a 502.
    if (res.status === 404 && allowNotFound) {
      return { __notFound: true };
    }
    const body = await res.text().catch(() => '');
    const err = new Error(
      res.status === 401 || res.status === 403
        ? 'recruitment_upstream_unauthorized'
        : 'recruitment_upstream_error',
    );
    err.statusCode = 502;
    err.detail = `GET ${url} → ${res.status} ${body.slice(0, 200)}`;
    throw err;
  }
  return res.json();
}

// Accept multiple envelope shapes. The recruitment team may ship either
// a bare array or a wrapped object; we handle the common wrappings so the
// contract doesn't depend on a single convention.
function arrayOf(response) {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object') {
    if (Array.isArray(response.guides)) return response.guides;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.items)) return response.items;
  }
  return [];
}

// Pure projection. "First non-empty among a known set of field names" is
// simple mapping, not transformation — it lets us accept either legacy
// (id / fullName / mobile) or new (externalPersonId / displayName / phone)
// upstream naming without reshaping values.
//
// portalToken is forwarded IF upstream provides it (spec: "portalToken if
// present is sourced from recruitment"). When absent, the import endpoint
// generates one locally on create and preserves the existing one on update.
// Lifecycle hints we accept from upstream. Anything off this list is
// treated as null so unknown values don't leak into the GOS data model.
// The names are deliberately ENGLISH and STABLE — Hebrew display labels
// live in the client, not the database. Future upstream values can be
// added here without a schema change.
// Stable English values we accept. 'evaluator' was speculatively in
// this list earlier but recruitment doesn't model evaluator as a
// separate lifecycle — treating it as a role/permission belongs to
// Phase 2. Any unknown value upstream sends is dropped to null.
const KNOWN_LIFECYCLES = new Set(['trainee', 'staff']);

function projectGuide(g) {
  if (!g || typeof g !== 'object') return null;
  const externalPersonId =
    g.externalPersonId ?? g.id ?? g.guideId ?? g._id ?? null;
  const displayName = g.displayName ?? g.fullName ?? g.name ?? null;
  const email = g.email ?? null;
  const phone = g.phone ?? g.mobile ?? g.phoneNumber ?? null;
  const portalToken = g.portalToken ?? null;
  // Lifecycle hint — accept the first non-empty value among the
  // candidate fields. We do NOT read Hebrew status / stage labels;
  // upstream must send stable English values or null. Anything else
  // is dropped on the floor.
  const rawLifecycle =
    g.lifecycleHint ?? g.personType ?? g.type ?? g.role ?? null;
  const lifecycleHint =
    rawLifecycle && KNOWN_LIFECYCLES.has(String(rawLifecycle).trim())
      ? String(rawLifecycle).trim()
      : null;
  if (externalPersonId == null || String(externalPersonId).trim() === '') {
    return null;
  }
  if (displayName == null || String(displayName).trim() === '') return null;
  return {
    externalPersonId: String(externalPersonId).trim(),
    displayName: String(displayName).trim(),
    email: email ? String(email).trim() || null : null,
    phone: phone ? String(phone).trim() || null : null,
    portalToken: portalToken ? String(portalToken).trim() || null : null,
    lifecycleHint,
  };
}

async function getGuides() {
  const raw = await fetchUpstream('/api/export/guides');
  return arrayOf(raw).map(projectGuide).filter(Boolean);
}

// New unified people endpoint — includes both legacy guides AND
// active trainees + team members from the candidate pipeline, each
// row tagged with a stable English `lifecycleHint`. This is the
// post-evolution data source for GOS "אנשים וגישה".
async function getPeople() {
  const raw = await fetchUpstream('/api/export/people', {
    allowNotFound: true,
  });
  if (raw?.__notFound) return null;
  return arrayOf(raw).map(projectGuide).filter(Boolean);
}

// Exported for /api/people/import so the same upstream call backs both
// the preview (/api/recruitment/people) and the upsert endpoint.
//
// Prefers /api/export/people (unified roster with trainees). Falls
// back to /api/export/guides only if upstream returns 404 — covers
// the brief deploy window where one system is ahead of the other. A
// 502 or any other error propagates so the caller can surface it.
export async function getRecruitmentSnapshot() {
  const unified = await getPeople();
  if (unified !== null) {
    return { people: unified, trainingMaterials: [] };
  }
  const legacy = await getGuides();
  return { people: legacy, trainingMaterials: [] };
}

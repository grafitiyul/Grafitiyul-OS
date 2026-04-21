import { Router } from 'express';
import { handle } from '../asyncHandler.js';

// Live recruitment-export integration.
//
// The recruitment system (grafitiyul-recruitment) exposes read-only export
// endpoints. This router proxies them into the management system's
// /api/recruitment/* namespace and is the ONLY source of truth for
// imported guide identity.
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

async function fetchUpstream(path) {
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
function projectGuide(g) {
  if (!g || typeof g !== 'object') return null;
  const externalPersonId =
    g.externalPersonId ?? g.id ?? g.guideId ?? g._id ?? null;
  const displayName = g.displayName ?? g.fullName ?? g.name ?? null;
  const email = g.email ?? null;
  const phone = g.phone ?? g.mobile ?? g.phoneNumber ?? null;
  const portalToken = g.portalToken ?? null;
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
  };
}

async function getGuides() {
  const raw = await fetchUpstream('/api/export/guides');
  return arrayOf(raw).map(projectGuide).filter(Boolean);
}

// Exported for /api/people/import so the same upstream call backs both
// the preview (/api/recruitment/people) and the upsert endpoint.
export async function getRecruitmentSnapshot() {
  const people = await getGuides();
  return { people, trainingMaterials: [] };
}

const router = Router();

router.get(
  '/people',
  handle(async (_req, res) => {
    res.json(await getGuides());
  }),
);

// Training-materials export is not yet wired on the upstream side. When
// it lands, swap the empty array for a fetchUpstream('/api/export/...')
// call following the same pattern as /people above.
router.get(
  '/training-materials',
  handle(async (_req, res) => {
    res.json([]);
  }),
);

router.get(
  '/',
  handle(async (_req, res) => {
    res.json(await getRecruitmentSnapshot());
  }),
);

// Local error handler — converts our structured errors (with statusCode +
// detail) into proper HTTP responses so the client sees 502/503 instead
// of a generic 500 when upstream is down or misconfigured.
router.use((err, _req, res, _next) => {
  console.error('[recruitment]', err);
  const status = err?.statusCode && Number.isInteger(err.statusCode)
    ? err.statusCode
    : 500;
  res.status(status).json({
    error: err?.message || 'internal_error',
    detail: err?.detail || null,
  });
});

export default router;

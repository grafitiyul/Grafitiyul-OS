// Vimeo as an external SOURCE provider, supporting BOTH storage strategies.
//
// The deliberately-deferred product decision (2026-08-08) is that Vimeo is
// neither permanently external nor permanently imported — the choice is made
// per import. This module therefore builds everything up to that decision and
// then refuses to guess:
//
//   ** "Import to R2" is offered ONLY when the LIVE token actually returns
//      downloadable source files. It is never inferred from a plan name, a
//      price tier, or documentation. **
//
// Two independent things must both be true, and they fail differently:
//   1. the access token carries the `video_files` scope, and
//   2. the account's plan actually exposes `download`/`files` on a video.
// A token can hold the scope while the plan returns nothing, so capabilities()
// checks the scope AND probes a real video before reporting availability.
//
// Official API only — no page scraping, ever.
//
// Env: VIMEO_ACCESS_TOKEN.

const API = 'https://api.vimeo.com';

export const PROVIDER = 'vimeo';

export function isConfigured() {
  return !!process.env.VIMEO_ACCESS_TOKEN;
}

export function configHint() {
  return {
    provider: PROVIDER,
    configured: isConfigured(),
    requiredEnv: ['VIMEO_ACCESS_TOKEN'],
    note: 'טוקן גישה של Vimeo. ייבוא כהפניה עובד עם הרשאות בסיסיות; "ייבוא ל-R2" נפתח רק אם הטוקן והחשבון באמת מחזירים קובצי מקור.',
  };
}

async function call(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = body?.error || body?.developer_message || `http_${res.status}`;
    const err = new Error(`vimeo_api_error: ${reason}`);
    err.status = res.status === 401 || res.status === 403 ? 422 : 502;
    err.providerReason = reason;
    throw err;
  }
  return body;
}

// Fields requested for every listing. `download` and `files` are the two that
// decide mirrorability; asking for them costs nothing and their ABSENCE is the
// signal we act on.
const VIDEO_FIELDS = [
  'uri',
  'name',
  'description',
  'duration',
  'created_time',
  'modified_time',
  'link',
  'pictures.sizes',
  'privacy.download',
  'download',
  'files',
].join(',');

function idFromUri(uri) {
  const m = /\/videos\/(\d+)/.exec(String(uri || ''));
  return m ? m[1] : null;
}

function bestPicture(pictures) {
  const sizes = pictures?.sizes || [];
  if (!sizes.length) return null;
  return sizes[sizes.length - 1]?.link || null;
}

/**
 * Downloadable source files for ONE video, or [] when the account/token does
 * not expose any. Never throws for "not available" — absence is data.
 */
export function downloadableFiles(video) {
  const out = [];
  for (const f of video?.download || []) {
    if (f?.link) {
      out.push({
        quality: f.quality || f.rendition || null,
        width: f.width || null,
        height: f.height || null,
        sizeBytes: f.size || null,
        mimeType: f.type || null,
        link: f.link,
      });
    }
  }
  if (out.length === 0) {
    for (const f of video?.files || []) {
      if (f?.link && f?.type && !String(f.type).includes('mpegurl')) {
        out.push({
          quality: f.quality || null,
          width: f.width || null,
          height: f.height || null,
          sizeBytes: f.size || null,
          mimeType: f.type,
          link: f.link,
        });
      }
    }
  }
  // Largest first — the mirror should take the best available source.
  return out.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
}

/**
 * What this account can ACTUALLY do right now.
 *
 * Reported from live evidence only:
 *   scopes        — from /oauth/verify (what the token is permitted to do)
 *   probe         — one real video inspected for downloadable files
 *   canMirrorToR2 — true only when a real file link was observed
 *
 * Never returns canMirrorToR2 true on the strength of the scope alone: a token
 * can carry `video_files` while the plan exposes nothing, and promising an
 * import that then fails is worse than saying it is unavailable.
 */
export async function capabilities() {
  if (!isConfigured()) {
    return {
      configured: false,
      canListVideos: false,
      canMirrorToR2: false,
      reason: 'vimeo_not_configured',
      requiredEnv: ['VIMEO_ACCESS_TOKEN'],
    };
  }
  const result = {
    configured: true,
    canListVideos: false,
    canMirrorToR2: false,
    scopes: [],
    hasVideoFilesScope: false,
    probe: null,
    reason: null,
  };
  try {
    const verify = await call('/oauth/verify');
    result.scopes = String(verify?.scope || '').split(/\s+/).filter(Boolean);
    result.hasVideoFilesScope = result.scopes.includes('video_files');
    result.user = verify?.user?.name || null;
  } catch (e) {
    result.reason = e.providerReason || e.message;
    return result;
  }

  try {
    const page = await call('/me/videos', { per_page: 1, fields: VIDEO_FIELDS });
    result.canListVideos = true;
    result.videoCount = page?.total ?? null;
    const first = page?.data?.[0] || null;
    if (!first) {
      result.probe = 'no_videos_to_probe';
      // Nothing to inspect: the scope may be present but availability is still
      // unproven, so the import path stays closed rather than optimistic.
      result.reason = 'no_videos_available_to_verify_download';
      return result;
    }
    const files = downloadableFiles(first);
    result.probe = {
      videoId: idFromUri(first.uri),
      downloadArrayPresent: Array.isArray(first.download),
      filesArrayPresent: Array.isArray(first.files),
      usableFileCount: files.length,
      privacyDownload: first?.privacy?.download ?? null,
    };
    result.canMirrorToR2 = files.length > 0;
    if (!result.canMirrorToR2) {
      result.reason = result.hasVideoFilesScope
        ? 'plan_does_not_expose_source_files'
        : 'token_missing_video_files_scope';
    }
  } catch (e) {
    result.reason = e.providerReason || e.message;
  }
  return result;
}

/** One page of the authenticated account's videos. */
export async function listVideos({ page = 1, perPage = 25 } = {}) {
  const data = await call('/me/videos', {
    page,
    per_page: Math.min(Number(perPage) || 25, 50),
    fields: VIDEO_FIELDS,
    sort: 'date',
    direction: 'desc',
  });
  return {
    total: data?.total ?? null,
    page: data?.page ?? page,
    nextPage: data?.paging?.next ? (Number(data.page) || page) + 1 : null,
    videos: (data?.data || [])
      .map((v) => {
        const externalId = idFromUri(v.uri);
        if (!externalId) return null;
        const files = downloadableFiles(v);
        return {
          provider: PROVIDER,
          externalId,
          title: v.name || '(ללא כותרת)',
          description: v.description || null,
          thumbnailUrl: bestPicture(v.pictures),
          publishedAt: v.created_time || null,
          updatedAt: v.modified_time || null,
          durationSeconds: v.duration || null,
          url: v.link || `https://vimeo.com/${externalId}`,
          // Per-video, from live evidence — some videos in an account may be
          // downloadable while others are not.
          canMirrorToR2: files.length > 0,
          mirrorBlockedReason: files.length ? null : 'no_source_file_exposed',
          bestFile: files[0] || null,
        };
      })
      .filter(Boolean),
  };
}

/** Fresh source-file list for ONE video — the mirror job re-reads this, because
 * Vimeo's file links are short-lived and must never be persisted. */
export async function sourceFilesFor(externalId) {
  const v = await call(`/videos/${encodeURIComponent(externalId)}`, { fields: VIDEO_FIELDS });
  return downloadableFiles(v);
}

export function embedUrl(externalId) {
  return `https://player.vimeo.com/video/${encodeURIComponent(externalId)}`;
}

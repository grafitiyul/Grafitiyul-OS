// YouTube as an external SOURCE provider.
//
// Reference-only, by product decision: importing a YouTube video creates a
// LibraryItem plus an EXTERNAL_REFERENCE media row carrying metadata. **No
// video file is ever downloaded.** YouTube stays the host unless we separately
// possess and upload the original ourselves.
//
// Official YouTube Data API v3 only — no scraping, no unofficial endpoints.
//
// Env: YOUTUBE_API_KEY (a server API key; restrict it to the YouTube Data API
// in Google Cloud). Absent → isConfigured() is false and every caller shows an
// honest "not configured" state instead of failing mysteriously.

const API = 'https://www.googleapis.com/youtube/v3';

export const PROVIDER = 'youtube';

export function isConfigured() {
  return !!process.env.YOUTUBE_API_KEY;
}

export function configHint() {
  return {
    provider: PROVIDER,
    configured: isConfigured(),
    requiredEnv: ['YOUTUBE_API_KEY'],
    note: 'מפתח API של YouTube Data API v3. הייבוא שומר הפניה בלבד — הסרטון נשאר ביוטיוב.',
  };
}

async function call(path, params) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Surface the provider's own reason — "quota exceeded" and "bad key" need
    // very different responses from the operator, and a generic failure hides
    // which one happened.
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.message || `http_${res.status}`;
    const err = new Error(`youtube_api_error: ${reason}`);
    err.status = res.status === 403 ? 422 : 502;
    err.providerReason = reason;
    throw err;
  }
  return body;
}

// PT1H2M3S → 3723. Returns null for the live/unknown case rather than 0, so a
// missing duration never renders as "0:00".
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => (x == null ? 0 : Number(x)));
  const total = d * 86400 + h * 3600 + min * 60 + s;
  return total > 0 ? total : null;
}

function bestThumb(thumbnails) {
  if (!thumbnails) return null;
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    null
  );
}

/** Resolve a channel's uploads playlist id (and its display name). */
export async function resolveChannel({ channelId, handle }) {
  const params = channelId ? { id: channelId } : { forHandle: String(handle || '').replace(/^@/, '') };
  const data = await call('channels', { part: 'contentDetails,snippet', ...params });
  const ch = data?.items?.[0];
  if (!ch) {
    const err = new Error('youtube_channel_not_found');
    err.status = 404;
    throw err;
  }
  return {
    channelId: ch.id,
    title: ch.snippet?.title || null,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads || null,
  };
}

/**
 * One page of a channel's uploads, enriched with duration.
 *
 * playlistItems does not carry duration, so the ids are looked up once against
 * `videos` — two calls per page rather than one per video.
 */
export async function listChannelVideos({ uploadsPlaylistId, pageToken = null, maxResults = 25 }) {
  const page = await call('playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: uploadsPlaylistId,
    maxResults: Math.min(Number(maxResults) || 25, 50),
    pageToken,
  });
  const items = page?.items || [];
  const ids = items.map((i) => i.contentDetails?.videoId).filter(Boolean);
  let durations = new Map();
  if (ids.length) {
    const details = await call('videos', { part: 'contentDetails', id: ids.join(',') });
    durations = new Map(
      (details?.items || []).map((v) => [v.id, parseIsoDuration(v.contentDetails?.duration)]),
    );
  }
  return {
    nextPageToken: page?.nextPageToken || null,
    total: page?.pageInfo?.totalResults ?? null,
    videos: items
      .map((i) => {
        const id = i.contentDetails?.videoId;
        if (!id) return null;
        return {
          provider: PROVIDER,
          externalId: id,
          title: i.snippet?.title || '(ללא כותרת)',
          description: i.snippet?.description || null,
          thumbnailUrl: bestThumb(i.snippet?.thumbnails),
          publishedAt: i.contentDetails?.videoPublishedAt || i.snippet?.publishedAt || null,
          durationSeconds: durations.get(id) ?? null,
          url: `https://www.youtube.com/watch?v=${id}`,
          // YouTube is never mirrorable through this connector.
          canMirrorToR2: false,
          mirrorBlockedReason: 'youtube_download_not_supported',
        };
      })
      .filter(Boolean),
  };
}

/** The embed URL used by the item view. Privacy-enhanced host, no autoplay. */
export function embedUrl(externalId) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(externalId)}`;
}

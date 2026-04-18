// Parse a user-supplied URL into a structured embed descriptor.
// We never reuse the raw URL as iframe src — we rebuild it from
// (provider, videoId, videoHash) so query-parameter injection through a
// crafted paste can't happen.

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);

const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);

const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_RE = /^[0-9]{6,15}$/;
const VIMEO_HASH_RE = /^[A-Za-z0-9]{6,32}$/;
// Drive file IDs are base64-url-ish, typically 25–44 chars in practice but
// Google doesn't publish a fixed length — accept 12+ safe chars.
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{12,}$/;

export function parseEmbedUrl(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();

  // -------- YouTube --------
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\/+/, '').split('/')[0];
    return makeYouTube(id);
  }
  if (YT_HOSTS.has(host)) {
    if (u.pathname === '/watch') {
      return makeYouTube(u.searchParams.get('v'));
    }
    const shorts = u.pathname.match(/^\/shorts\/([^/?]+)/);
    if (shorts) return makeYouTube(shorts[1], { isShort: true });
    const embed = u.pathname.match(/^\/embed\/([^/?]+)/);
    if (embed) return makeYouTube(embed[1]);
    const live = u.pathname.match(/^\/live\/([^/?]+)/);
    if (live) return makeYouTube(live[1]);
  }

  // -------- Vimeo --------
  // Path shapes we accept:
  //   /{id}
  //   /{id}/{hash}                       (unlisted)
  //   /channels/name/{id}
  //   /channels/name/{id}/{hash}
  //   /groups/name/videos/{id}
  //   /showcase/N/video/{id}
  //   /manage/videos/{id}                (shouldn't be shared but handle gracefully)
  // Also accept ?h={hash} query for all shapes.
  if (VIMEO_HOSTS.has(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    const idIdx = parts.findIndex((p) => VIMEO_ID_RE.test(p));
    if (idIdx < 0) return null;
    const videoId = parts[idIdx];
    let hash = null;
    if (idIdx + 1 < parts.length) {
      const next = parts[idIdx + 1];
      if (VIMEO_HASH_RE.test(next)) hash = next;
    }
    if (!hash) {
      const h = u.searchParams.get('h');
      if (h && VIMEO_HASH_RE.test(h)) hash = h;
    }
    return makeVimeo(videoId, hash);
  }
  if (host === 'player.vimeo.com') {
    const m = u.pathname.match(/^\/video\/(\d+)/);
    if (m) {
      const h = u.searchParams.get('h');
      return makeVimeo(m[1], VIMEO_HASH_RE.test(h || '') ? h : null);
    }
  }

  // -------- Google Drive --------
  if (DRIVE_HOSTS.has(host)) {
    // /file/d/{id}/...  OR  /d/{id} (older)
    const fileMatch =
      u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/) ||
      u.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/);
    if (fileMatch) return makeDrive(fileMatch[1]);
    // /open?id=... or /uc?id=...
    if (u.pathname === '/open' || u.pathname === '/uc') {
      const id = u.searchParams.get('id');
      if (id && DRIVE_ID_RE.test(id)) return makeDrive(id);
    }
  }

  return null;
}

function makeYouTube(id, opts = {}) {
  if (!id || !YT_ID_RE.test(id)) return null;
  const isShort = !!opts.isShort;
  return {
    provider: 'youtube',
    videoId: id,
    videoHash: null,
    aspectRatio: isShort ? '9:16' : '16:9',
    defaultWidth: isShort ? '30' : '60',
    embedUrl: buildEmbedUrl('youtube', id),
  };
}

function makeVimeo(id, hash) {
  if (!id || !VIMEO_ID_RE.test(id)) return null;
  const h = hash && VIMEO_HASH_RE.test(hash) ? hash : null;
  return {
    provider: 'vimeo',
    videoId: id,
    videoHash: h,
    aspectRatio: '16:9',
    defaultWidth: '60',
    embedUrl: buildEmbedUrl('vimeo', id, { hash: h }),
  };
}

function makeDrive(id) {
  if (!id || !DRIVE_ID_RE.test(id)) return null;
  return {
    provider: 'drive',
    videoId: id,
    videoHash: null,
    aspectRatio: '16:9',
    defaultWidth: '60',
    embedUrl: buildEmbedUrl('drive', id),
  };
}

// Single source of truth for embed URLs. Always rebuild from
// (provider, videoId, hash) — never from a user-supplied full URL.
export function buildEmbedUrl(provider, videoId, opts = {}) {
  if (!videoId) return null;
  if (provider === 'youtube') {
    // youtube-nocookie serves the same player but doesn't set tracking
    // cookies until the viewer starts playback.
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
  }
  if (provider === 'vimeo') {
    const base = `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`;
    if (opts?.hash && VIMEO_HASH_RE.test(opts.hash)) {
      return `${base}?h=${encodeURIComponent(opts.hash)}`;
    }
    return base;
  }
  if (provider === 'drive') {
    return `https://drive.google.com/file/d/${encodeURIComponent(videoId)}/preview`;
  }
  return null;
}

export function isKnownProvider(p) {
  return p === 'youtube' || p === 'vimeo' || p === 'drive';
}

export function providerLabel(p) {
  if (p === 'youtube') return 'YouTube';
  if (p === 'vimeo') return 'Vimeo';
  if (p === 'drive') return 'Google Drive';
  return p || '';
}

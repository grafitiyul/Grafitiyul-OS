// Parse a user-supplied URL into a structured embed descriptor.
// We never reuse the raw URL as iframe src — we rebuild it from
// (provider, videoId) to prevent arbitrary query-parameter injection
// (autoplay, listType, controls=0, origin, etc).

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);

const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_RE = /^[0-9]{6,15}$/;

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

  // YouTube
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\/+/, '').split('/')[0];
    return makeYouTube(id);
  }
  if (YT_HOSTS.has(host)) {
    if (u.pathname === '/watch') {
      return makeYouTube(u.searchParams.get('v'));
    }
    const shorts = u.pathname.match(/^\/shorts\/([^/?]+)/);
    if (shorts) return makeYouTube(shorts[1]);
    const embed = u.pathname.match(/^\/embed\/([^/?]+)/);
    if (embed) return makeYouTube(embed[1]);
    const live = u.pathname.match(/^\/live\/([^/?]+)/);
    if (live) return makeYouTube(live[1]);
  }

  // Vimeo
  if (VIMEO_HOSTS.has(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    const id = parts[parts.length - 1];
    return makeVimeo(id);
  }
  if (host === 'player.vimeo.com') {
    const m = u.pathname.match(/^\/video\/(\d+)/);
    if (m) return makeVimeo(m[1]);
  }

  return null;
}

function makeYouTube(id) {
  if (!id || !YT_ID_RE.test(id)) return null;
  return {
    provider: 'youtube',
    videoId: id,
    embedUrl: buildEmbedUrl('youtube', id),
  };
}

function makeVimeo(id) {
  if (!id || !VIMEO_ID_RE.test(id)) return null;
  return {
    provider: 'vimeo',
    videoId: id,
    embedUrl: buildEmbedUrl('vimeo', id),
  };
}

// Single source of truth for embed URLs. Always rebuild from
// (provider, id) — never from a user-supplied full URL.
export function buildEmbedUrl(provider, videoId) {
  if (!videoId) return null;
  if (provider === 'youtube') {
    // youtube-nocookie serves the same player but doesn't set tracking cookies
    // until the viewer starts playback.
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
  }
  if (provider === 'vimeo') {
    return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`;
  }
  return null;
}

export function isKnownProvider(p) {
  return p === 'youtube' || p === 'vimeo';
}

export function providerLabel(p) {
  if (p === 'youtube') return 'YouTube';
  if (p === 'vimeo') return 'Vimeo';
  return p || '';
}

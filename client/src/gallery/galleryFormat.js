// Small formatting helpers shared by every gallery surface (admin workspace,
// guide portal, public customer page).

export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return '';
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${m}:${String(rest).padStart(2, '0')}`;
}

export const UPLOADER_TYPE_LABELS = {
  office: 'משרד',
  guide: 'מדריך',
  customer: 'לקוח',
};

export function uploaderLabel(media) {
  const type = UPLOADER_TYPE_LABELS[media.uploadedByType] || '';
  if (media.uploadedByLabel && type) return `${type} · ${media.uploadedByLabel}`;
  return media.uploadedByLabel || type || '';
}

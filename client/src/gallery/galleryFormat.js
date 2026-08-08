import { mediaStrings } from './i18n.js';

// Small formatting helpers shared by every gallery surface (admin workspace,
// guide portal, public customer page).
//
// Byte and duration formatting is deliberately language-NEUTRAL: digits, ':'
// and the SI units (B/KB/MB/GB) read the same in both languages, so translating
// them would add drift for no reader benefit.

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

// Uploader type is a stored ENUM ('office' | 'guide' | 'customer'). It is never
// rendered raw — the words come from the media registry, so the same three
// concepts read identically in the admin, the guide portal and the public
// gallery, in whichever language that surface is showing.
//
// The Hebrew default keeps every existing admin caller working unchanged.
export function uploaderLabel(media, t = mediaStrings('he')) {
  const type = t.uploader[media?.uploadedByType] || '';
  if (media?.uploadedByLabel && type) return `${type}${t.uploadQueue.separator}${media.uploadedByLabel}`;
  return media?.uploadedByLabel || type || '';
}

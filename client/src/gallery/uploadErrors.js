import { mediaStrings } from './i18n.js';

// Human-readable upload failure reasons — ONE mapper for every surface (staff
// workspace, guide portal, public customer gallery). The raw code stays
// available for QA (UploadQueuePanel puts it in the row's title attribute); the
// user sees WHAT went wrong, not 'upload_http_403'.
//
// Bilingual by parameter, not by duplication: the wording lives in the media
// registry (i18n.js) and this file only maps a CODE to a registry key. The
// Hebrew-only admin surfaces call it with no argument and keep working
// unchanged; the public gallery passes the visitor's strings.

// Raw code → registry key. Codes are the server/transport vocabulary and are
// deliberately NOT renamed to match the registry — they are a wire contract.
const CODE_TO_KEY = {
  unsupported_type: 'unsupported_type',
  file_too_large: 'file_too_large',
  invalid_size: 'invalid_size',
  // XHR status 0: offline, connection dropped mid-file, or the browser blocked
  // the request because the storage bucket has no CORS policy.
  network_error: 'network',
  aborted: 'canceled',
  object_missing: 'incomplete',
  invalid_content: 'verification_failed',
  no_parts_uploaded: 'no_parts',
  upload_not_found: 'session_expired',
  not_pending: 'not_pending',
  already_ready: 'already_ready',
  tour_cancelled: 'tour_cancelled',
  uploads_disabled: 'uploads_disabled',
  gallery_archived: 'gallery_archived',
  r2_not_configured: 'r2_not_configured',
  too_many_files_per_call: 'too_many_files_per_call',
  not_allowed: 'forbidden',
  not_found: 'not_found',
  no_files: 'no_files',
  rejected: 'rejected',
  // Server-side 5xx — the request never reached storage. Retryable.
  internal_error: 'server',
};

/**
 * @param {string} code raw failure code
 * @param {object} [t] media strings; defaults to Hebrew for the admin surfaces
 */
export function uploadErrorLabel(code, t = mediaStrings('he')) {
  if (!code) return '';
  const e = t.uploadErrors;
  const c = String(code);
  const key = CODE_TO_KEY[c];
  if (key && e[key]) return e[key];
  if (c.startsWith('upload_http_403')) return e.storage_forbidden;
  if (c.startsWith('upload_http_4')) return e.storageRejected(c.replace('upload_http_', ''));
  if (c.startsWith('upload_http_5')) return e.storageTemporary(c.replace('upload_http_', ''));
  if (c.startsWith('HTTP ')) return e.storageRejected(c.slice(5).trim());
  // Unknown code: show the generic wording rather than leaking a raw
  // implementation string to a customer.
  return e.generic;
}

// Structured, greppable logs for the upload path. One line per event:
//   [tour-gallery] <event> {"tourEventId":"…", …}
// Tokens are NEVER logged whole — maskToken keeps a 6-char prefix, enough to
// correlate a report with a link row without leaking the credential.

export function glog(event, data) {
  try {
    console.log('[tour-gallery]', event, JSON.stringify(data));
  } catch {
    console.log('[tour-gallery]', event);
  }
}

export function maskToken(token) {
  const t = String(token || '');
  return t ? `${t.slice(0, 6)}…(${t.length})` : '(empty)';
}

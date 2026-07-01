// Pure file-acceptance logic shared by useFileDrop. Kept DOM-free so it can be
// unit-tested directly (no browser needed) and reused by both the picker and
// the drop path — guaranteeing a dropped file is validated exactly like a
// picked one. A native drop bypasses the <input accept> filter, so we MUST
// re-check dropped files here or drop would accept types the picker rejects.

// Does `file` (anything with .type and .name) satisfy an `accept` string of the
// same shape the HTML <input accept> attribute uses: a comma list of
// extensions (".pdf"), wildcard mimes ("image/*"), or exact mimes
// ("application/pdf")? Empty/"*" accepts everything.
export function matchesAccept(file, accept) {
  if (!accept || accept === '*' || accept === '*/*') return true;
  const type = (file?.type || '').toLowerCase();
  const name = (file?.name || '').toLowerCase();
  return accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule); // extension
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1)); // image/*
      return type === rule; // exact mime
    });
}

// Split a FileList / array of files into { accepted, rejected } using the same
// rules as the picker, plus an optional size cap. `multiple: false` keeps only
// the first file. `rejected` carries a reason ('type' | 'size') so callers can
// message the user clearly.
export function pickAcceptedFiles(fileList, { accept = 'image/*', multiple = false, maxBytes = 0 } = {}) {
  let files = Array.from(fileList || []);
  if (!multiple) files = files.slice(0, 1);
  const accepted = [];
  const rejected = [];
  for (const f of files) {
    if (!matchesAccept(f, accept)) {
      rejected.push({ file: f, reason: 'type' });
      continue;
    }
    if (maxBytes && f.size > maxBytes) {
      rejected.push({ file: f, reason: 'size' });
      continue;
    }
    accepted.push(f);
  }
  return { accepted, rejected };
}

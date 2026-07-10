// Tour Gallery upload engine — shared by the admin workspace, the guide
// portal, and the public customer page. Framework-agnostic: React components
// subscribe to snapshots; the queue itself lives outside the component tree so
// navigation inside the app never kills an in-flight batch.
//
// Design constraints (project decisions):
//   * originals go DIRECTLY to R2 via presigned URLs — never through Express;
//   * no practical batch-size limit: files wait in a queue, URLs are minted
//     per file when its turn comes (so URL expiry can't strand a long batch),
//     and derivatives are generated lazily one file at a time (no memory
//     blow-up on a 300-photo selection);
//   * every failure is per-file and retryable; nothing is marked done unless
//     the server verified the object;
//   * multipart for large files, parts uploaded sequentially per file with
//     bounded file-level concurrency (mobile-friendly).
//
// The `endpoints` adapter maps the queue onto whichever API surface owns the
// gallery: { initiate(files), urls(mediaId, body), complete(mediaId, body),
// abort(mediaId) } — all returning parsed JSON (throwing on HTTP errors).

const FILE_CONCURRENCY = 3;
const PART_URL_BATCH = 10;
const AUTO_RETRIES = 3;
const INITIATE_CHUNK = 100;
const THUMB_MAX_DIM = 640;

let keySeq = 0;

function inferKind(file) {
  const t = String(file.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  // iOS sometimes reports empty types — fall back to the extension.
  const ext = (file.name || '').split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'ogv', 'm4v'].includes(ext)) return 'video';
  return null;
}

function mimeForFile(file) {
  if (file.type) return file.type;
  const ext = (file.name || '').split('.').pop()?.toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg',
    m4v: 'video/x-m4v',
  };
  return map[ext] || 'application/octet-stream';
}

// PUT a blob with progress via XHR (fetch has no upload progress).
function xhrPut(url, blob, contentType, onProgress, registerAbort) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload_http_${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('network_error'));
    xhr.onabort = () => reject(Object.assign(new Error('aborted'), { aborted: true }));
    registerAbort?.(() => xhr.abort());
    xhr.send(blob);
  });
}

// ── lazy client-side derivatives (best-effort, never blocking) ──────────────

async function makeImageThumb(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, THUMB_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.8));
    return { blob, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

function makeVideoPoster(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    const cleanup = (result) => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(result);
    };
    const timer = setTimeout(() => cleanup(null), 8000);
    video.onerror = () => {
      clearTimeout(timer);
      cleanup(null);
    };
    video.onloadedmetadata = () => {
      const meta = {
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
      };
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      video.onseeked = async () => {
        clearTimeout(timer);
        try {
          if (!video.videoWidth) return cleanup({ ...meta, blob: null });
          const scale = Math.min(1, THUMB_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.8));
          cleanup({ ...meta, blob });
        } catch {
          cleanup({ ...meta, blob: null });
        }
      };
    };
  });
}

// ── the queue ────────────────────────────────────────────────────────────────

export function createGalleryUploader({ endpoints, concurrency = FILE_CONCURRENCY }) {
  const items = new Map(); // key → item
  const listeners = new Set();
  let activeCount = 0;
  let notifyScheduled = false;

  function snapshotTotals() {
    const t = {
      total: 0, queued: 0, preparing: 0, uploading: 0, processing: 0,
      done: 0, failed: 0, rejected: 0, canceled: 0,
      bytesTotal: 0, bytesSent: 0,
    };
    for (const it of items.values()) {
      t.total += 1;
      t[it.status] = (t[it.status] || 0) + 1;
      t.bytesTotal += it.size;
      t.bytesSent += Math.round(it.size * (it.progress || 0));
    }
    return t;
  }

  function notify() {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      const snap = { items: [...items.values()], totals: snapshotTotals() };
      for (const fn of listeners) fn(snap);
    });
  }

  function setItem(item, patch) {
    Object.assign(item, patch);
    notify();
  }

  async function runFile(item) {
    activeCount += 1;
    setItem(item, { status: 'uploading', progress: 0, error: null, attempt: item.attempt + 1 });
    let abortCurrent = null;
    item.abort = () => {
      item.canceled = true;
      abortCurrent?.();
    };
    try {
      // Lazy derivatives — one file at a time, right before ITS upload.
      let derived = item.derived;
      if (!derived) {
        derived = { blob: null, width: null, height: null, durationSeconds: null };
        try {
          if (item.kind === 'image') {
            const t = await makeImageThumb(item.file);
            derived = { ...t, durationSeconds: null };
          } else {
            const p = await makeVideoPoster(item.file);
            if (p) derived = p;
          }
        } catch {
          /* HEIC on non-Safari etc. — grid shows a placeholder, original is intact */
        }
        item.derived = derived;
      }
      if (item.canceled) throw Object.assign(new Error('aborted'), { aborted: true });

      const wantsDerivative = !!derived.blob;
      if (item.plan === 'multipart') {
        const partCount = item.partCount;
        let sent = 0;
        for (let start = 1; start <= partCount; start += PART_URL_BATCH) {
          const nums = [];
          for (let n = start; n < start + PART_URL_BATCH && n <= partCount; n += 1) nums.push(n);
          const { partUrls } = await endpoints.urls(item.mediaId, { partNumbers: nums });
          for (const n of nums) {
            if (item.canceled) throw Object.assign(new Error('aborted'), { aborted: true });
            const from = (n - 1) * item.partSize;
            const chunk = item.file.slice(from, Math.min(from + item.partSize, item.size));
            await xhrPut(partUrls[n], chunk, null, (loaded) => {
              setItem(item, { progress: Math.min(0.99, (sent + loaded) / item.size) });
            }, (a) => { abortCurrent = a; });
            sent += chunk.size;
            setItem(item, { progress: Math.min(0.99, sent / item.size) });
          }
        }
        // Derivative target URLs (thumb/poster) ride on a final urls call.
        if (wantsDerivative) {
          const extra = await endpoints.urls(item.mediaId, {
            thumb: item.kind === 'image',
            poster: item.kind === 'video',
          });
          const derivUrl = item.kind === 'image' ? extra.thumbPutUrl : extra.posterPutUrl;
          if (derivUrl) await xhrPut(derivUrl, derived.blob, 'image/webp', null, (a) => { abortCurrent = a; });
        }
      } else {
        const targets = await endpoints.urls(item.mediaId, {
          thumb: wantsDerivative && item.kind === 'image',
          poster: wantsDerivative && item.kind === 'video',
        });
        await xhrPut(targets.putUrl, item.file, item.mimeType, (loaded, total) => {
          setItem(item, { progress: Math.min(0.99, loaded / total) });
        }, (a) => { abortCurrent = a; });
        const derivUrl = item.kind === 'image' ? targets.thumbPutUrl : targets.posterPutUrl;
        if (wantsDerivative && derivUrl) {
          await xhrPut(derivUrl, derived.blob, 'image/webp', null, (a) => { abortCurrent = a; });
        }
      }

      if (item.canceled) throw Object.assign(new Error('aborted'), { aborted: true });
      setItem(item, { status: 'processing', progress: 1 });
      const media = await endpoints.complete(item.mediaId, {
        width: derived.width || undefined,
        height: derived.height || undefined,
        durationSeconds: derived.durationSeconds || undefined,
        hasThumb: item.kind === 'image' && !!derived.blob,
        hasPoster: item.kind === 'video' && !!derived.blob,
      });
      item.derived = null; // release the blob
      setItem(item, { status: 'done', media });
    } catch (e) {
      if (e?.aborted || item.canceled) {
        setItem(item, { status: 'canceled' });
        endpoints.abort(item.mediaId).catch(() => {});
      } else if (item.attempt < AUTO_RETRIES) {
        // Transient network blips retry silently with a short backoff.
        setItem(item, { status: 'queued', error: String(e?.message || e) });
        setTimeout(pump, 1500 * item.attempt);
      } else {
        setItem(item, { status: 'failed', error: String(e?.message || e) });
      }
    } finally {
      item.abort = null;
      activeCount -= 1;
      pump();
    }
  }

  function pump() {
    while (activeCount < concurrency) {
      const next = [...items.values()].find((i) => i.status === 'queued' && i.mediaId);
      if (!next) break;
      runFile(next);
    }
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      fn({ items: [...items.values()], totals: snapshotTotals() });
      return () => listeners.delete(fn);
    },

    // Add any number of files. Unsupported types are surfaced as 'rejected'
    // immediately; the rest initiate in chunks and start uploading.
    async addFiles(fileList) {
      const files = [...fileList];
      const fresh = [];
      for (const file of files) {
        const kind = inferKind(file);
        const key = `f${(keySeq += 1)}`;
        const item = {
          key, file, name: file.name || 'file', size: file.size, kind,
          mimeType: mimeForFile(file),
          status: kind ? 'preparing' : 'rejected',
          error: kind ? null : 'unsupported_type',
          progress: 0, attempt: 0, mediaId: null, plan: null,
          partSize: null, partCount: null, canceled: false, abort: null,
        };
        items.set(key, item);
        if (kind) fresh.push(item);
      }
      notify();
      for (let i = 0; i < fresh.length; i += INITIATE_CHUNK) {
        const chunk = fresh.filter((it) => !it.canceled).slice(i, i + INITIATE_CHUNK);
        if (!chunk.length) continue;
        try {
          const res = await endpoints.initiate(
            chunk.map((it) => ({
              clientKey: it.key,
              fileName: it.name,
              mimeType: it.mimeType,
              byteSize: it.size,
              capturedAt: it.file.lastModified ? new Date(it.file.lastModified).toISOString() : null,
            })),
          );
          const byKey = new Map((res.accepted || []).map((a) => [a.clientKey, a]));
          for (const it of chunk) {
            const a = byKey.get(it.key);
            if (a) {
              setItem(it, {
                mediaId: a.mediaId, plan: a.plan,
                partSize: a.partSize, partCount: a.partCount,
                status: it.canceled ? 'canceled' : 'queued',
              });
            } else {
              const rej = (res.rejected || []).find((r) => r.clientKey === it.key);
              setItem(it, { status: 'rejected', error: rej?.error || 'rejected' });
            }
          }
        } catch (e) {
          for (const it of chunk) setItem(it, { status: 'failed', error: String(e?.message || e) });
        }
        pump();
      }
    },

    retry(key) {
      const it = items.get(key);
      if (it && (it.status === 'failed' || it.status === 'canceled') && it.mediaId) {
        it.canceled = false;
        setItem(it, { status: 'queued', attempt: 0, error: null });
        pump();
      }
    },

    retryFailed() {
      for (const it of items.values()) {
        if (it.status === 'failed' && it.mediaId) {
          it.canceled = false;
          Object.assign(it, { status: 'queued', attempt: 0, error: null });
        }
      }
      notify();
      pump();
    },

    cancel(key) {
      const it = items.get(key);
      if (!it) return;
      if (it.status === 'uploading' || it.status === 'processing') it.abort?.();
      else if (it.status === 'queued' || it.status === 'preparing') {
        it.canceled = true;
        setItem(it, { status: 'canceled' });
        if (it.mediaId) endpoints.abort(it.mediaId).catch(() => {});
      }
    },

    cancelAll() {
      for (const it of [...items.values()]) this.cancel(it.key);
    },

    clearSettled() {
      for (const [k, it] of items) {
        if (['done', 'rejected', 'canceled'].includes(it.status)) items.delete(k);
      }
      notify();
    },

    hasActiveWork() {
      return [...items.values()].some((i) =>
        ['preparing', 'queued', 'uploading', 'processing'].includes(i.status),
      );
    },
  };
}

// Keep one uploader alive per gallery+surface for the whole SPA session, so
// leaving the gallery view does not kill an in-flight batch.
const registry = new Map();

export function getGalleryUploader(scopeKey, factory) {
  if (!registry.has(scopeKey)) registry.set(scopeKey, factory());
  return registry.get(scopeKey);
}

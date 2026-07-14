// Migration snapshot storage — a DEDICATED PRIVATE R2 bucket, separate from the
// public app bucket. Uses its own MIGRATION_R2_* credentials so legacy PII never
// touches the public-serving bucket. Presigned-only; no public base URL.
//
// This is the ONLY storage path for immutable snapshot objects. It never deletes
// snapshot objects (write-once); the only delete() it exposes is for the
// throwaway connectivity probe under the reserved `_connectivity/` prefix.
import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { snapshotStorageConfigured, snapshotBucketName } from './config.js';

let _client = null;
function client() {
  if (!_client) {
    const {
      MIGRATION_R2_ACCOUNT_ID,
      MIGRATION_R2_ACCESS_KEY_ID,
      MIGRATION_R2_SECRET_ACCESS_KEY,
    } = process.env;
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${MIGRATION_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: MIGRATION_R2_ACCESS_KEY_ID,
        secretAccessKey: MIGRATION_R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

export function bucket() {
  return snapshotBucketName();
}

// Upload bytes the server already holds (JSONL shards, manifests, attachment
// bodies). Optionally guards against overwrite (immutability) via a HEAD check.
export async function putObject({ key, body, contentType, ifAbsent = false }) {
  if (ifAbsent) {
    const existing = await headObject(key);
    if (existing) {
      const e = new Error(`refuse_overwrite: ${key} already exists (${existing.size}B)`);
      e.code = 'OBJECT_EXISTS';
      throw e;
    }
  }
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
  return key;
}

export async function headObject(key) {
  try {
    const out = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: Number(out.ContentLength ?? 0), etag: out.ETag || null };
  } catch (e) {
    if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

// Full object body as a UTF-8 string (manifests + JSONL read-back during verify).
export async function getObjectText(key) {
  const out = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// List object keys (+sizes) under a prefix (paged).
export async function listKeys(prefix) {
  const items = [];
  let token;
  do {
    const out = await client().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of out.Contents || []) {
      if (obj.Key) items.push({ key: obj.Key, size: Number(obj.Size ?? 0) });
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return items;
}

async function deleteObject(key) {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// Live connectivity probe: proves auth + bucket exists + read AND write, using a
// throwaway object under the reserved `_connectivity/` prefix (never inside
// snapshots/). Round-trips put → head → get → delete, then reports capabilities.
export async function checkConnectivity() {
  const result = {
    configured: snapshotStorageConfigured(),
    bucket: snapshotBucketName() || null,
    reachable: false, canList: false, canWrite: false, canRead: false, canDelete: false,
    error: null,
  };
  if (!result.configured) { result.error = 'MIGRATION_R2_* not fully configured'; return result; }
  try {
    await client().send(new ListObjectsV2Command({ Bucket: bucket(), MaxKeys: 1 }));
    result.reachable = true; result.canList = true;
  } catch (e) { result.error = `list_failed: ${e?.name || e?.message || e}`; return result; }

  const probeKey = `_connectivity/probe-${crypto.randomBytes(6).toString('hex')}.txt`;
  const token = crypto.randomBytes(16).toString('hex');
  try {
    await putObject({ key: probeKey, body: Buffer.from(token, 'utf8'), contentType: 'text/plain' });
    result.canWrite = true;
    const head = await headObject(probeKey);
    const body = await getObjectText(probeKey);
    result.canRead = head != null && body === token;
    await deleteObject(probeKey);
    result.canDelete = true;
  } catch (e) {
    result.error = `probe_failed: ${e?.name || e?.message || e}`;
    try { await deleteObject(probeKey); } catch { /* best effort */ }
  }
  result.ok = result.reachable && result.canWrite && result.canRead;
  return result;
}

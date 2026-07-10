import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Cloudflare R2 (S3-compatible) helper. Direct-to-R2 presigned uploads; the DB
// stores only metadata + object keys (no DB blobs). R2 is OPTIONAL at runtime:
// if the env vars are missing, isConfigured() is false and the upload routes
// return a clear error instead of crashing — the deploy stays safe before R2 is
// configured.
//
// Env vars:
//   R2_ACCOUNT_ID        Cloudflare account id (endpoint host)
//   R2_ACCESS_KEY_ID     R2 API token access key
//   R2_SECRET_ACCESS_KEY R2 API token secret
//   R2_BUCKET            bucket name
//   R2_PUBLIC_BASE_URL   public base URL for objects (r2.dev or custom domain)

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
} = process.env;

export const bucket = R2_BUCKET || '';

export function isConfigured() {
  return !!(
    R2_ACCOUNT_ID &&
    R2_ACCESS_KEY_ID &&
    R2_SECRET_ACCESS_KEY &&
    R2_BUCKET &&
    R2_PUBLIC_BASE_URL
  );
}

let _client = null;
function client() {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

// Collision-free object key under a folder, with a sanitised filename tail.
export function buildKey(folder, filename) {
  const safe = String(filename || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-80);
  const id = crypto.randomBytes(8).toString('hex');
  const clean = String(folder || 'misc').replace(/[^a-z0-9/_-]/gi, '') || 'misc';
  return `${clean}/${id}-${safe}`;
}

export function publicUrl(key) {
  const base = String(R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/${key}`;
}

export async function presignPut({ key, contentType }) {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client(), cmd, { expiresIn: 300 }); // 5 minutes
}

// Server-side upload for bytes the SERVER already holds (e.g. email attachments
// fetched from Gmail and cached privately). Client uploads keep using the
// presigned-PUT flow — this is only for server-origin bytes.
export async function putObject({ key, body, contentType }) {
  await client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
  return key;
}

// Short-lived read URL for PRIVATE objects (e.g. WhatsApp chat media — customer
// data that must never sit on a public URL). The admin-authed route mints one
// per view; the link dies in minutes.
export async function presignGet({ key, expiresIn = 300, downloadName }) {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    // Friendly download filename WITHOUT renaming the stored object — the key
    // stays immutable, the browser sees the display name.
    ...(downloadName
      ? {
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
            downloadName,
          )}`,
        }
      : {}),
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}

// Best-effort delete — never throw (storage cleanup must not break the request).
export async function deleteObject(key) {
  try {
    await client().send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
  } catch (e) {
    console.warn('[r2] delete failed for', key, e?.message);
  }
}

// Batch delete (up to 1000 keys per call, paged here). THROWS if any key
// failed to delete — destructive cleanup must know it was incomplete.
export async function deleteObjects(keys) {
  const all = [...keys];
  while (all.length) {
    const chunk = all.splice(0, 1000);
    const out = await client().send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    const errors = out?.Errors || [];
    if (errors.length) {
      throw new Error(
        `delete_objects_failed: ${errors.length} keys (first: ${errors[0]?.Key} ${errors[0]?.Code})`,
      );
    }
  }
}

// In-flight multipart uploads under a prefix (paged). Used by gallery cleanup
// and the abandoned-upload sweep so cancelled tours leave no hidden storage.
export async function listMultipartUploads(prefix) {
  const uploads = [];
  let keyMarker;
  let uploadIdMarker;
  do {
    const out = await client().send(
      new ListMultipartUploadsCommand({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      }),
    );
    for (const u of out.Uploads || []) {
      if (u.Key && u.UploadId) uploads.push({ key: u.Key, uploadId: u.UploadId });
    }
    keyMarker = out.IsTruncated ? out.NextKeyMarker : undefined;
    uploadIdMarker = out.IsTruncated ? out.NextUploadIdMarker : undefined;
  } while (keyMarker || uploadIdMarker);
  return uploads;
}

// Abort ONE multipart upload. Aborting an already-completed/aborted upload
// returns NoSuchUpload — treated as success (idempotent cleanup).
export async function abortMultipartUpload({ key, uploadId }) {
  try {
    await client().send(
      new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId }),
    );
  } catch (e) {
    if (e?.name === 'NoSuchUpload' || e?.Code === 'NoSuchUpload') return;
    throw e;
  }
}

// List ALL object keys under a prefix (paged). Used by account-scoped cleanup
// (e.g. purging every `whatsapp/<accountId>/…` object). Throws on failure —
// callers doing destructive work must know listing was incomplete.
export async function listKeys(prefix) {
  const keys = [];
  let token;
  do {
    const out = await client().send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of out.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

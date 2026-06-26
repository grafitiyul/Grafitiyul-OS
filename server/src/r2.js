import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
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

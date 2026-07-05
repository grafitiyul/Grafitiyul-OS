// R2 media store for the bridge — WhatsApp media is downloaded AT INGEST
// (WhatsApp's media URLs expire; postponing means permanently losing content)
// and uploaded PRIVATE to R2. Same env var names as the GOS server's r2.js so
// Railway configuration stays consistent across services.
//
// Key contract (purge + serving depend on it): every object key starts with
//   whatsapp/<accountId>/
// so account-level deletion is an exact prefix sweep and the GOS server can
// mint presigned GETs per key. Buckets stay private — no ACLs, no public URLs.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

export function isMediaConfigured() {
  return !!(config.r2AccountId && config.r2AccessKeyId && config.r2SecretAccessKey && config.r2Bucket);
}

let _client = null;
function client() {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

// whatsapp/<accountId>/<yyyy>/<mm>/<safeChat>/<safeMsgId>.<ext>
export function buildMediaKey(accountId, chatJid, messageId, extension, ts) {
  const safeChat = chatJid.replace(/[^a-z0-9_-]/gi, '_');
  const safeId = messageId.replace(/[^A-Za-z0-9_-]/g, '_');
  const yyyy = ts.getUTCFullYear();
  const mm = String(ts.getUTCMonth() + 1).padStart(2, '0');
  return `whatsapp/${accountId}/${yyyy}/${mm}/${safeChat}/${safeId}.${extension}`;
}

export async function storeMedia({ key, mimeType, data }) {
  await client().send(
    new PutObjectCommand({
      Bucket: config.r2Bucket,
      Key: key,
      Body: data,
      ContentType: mimeType || 'application/octet-stream',
    }),
  );
  return { key, size: data.byteLength };
}

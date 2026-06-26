import { api } from './api.js';

// Direct-to-R2 image upload:
//   1) ask the server for a presigned PUT URL + object key
//   2) PUT the bytes straight to R2 (not through our API)
//   3) persist a MediaFile row and return it ({ id, url, ... })
//
// Throws on failure (including 'r2_not_configured' → caller shows a clear
// "image storage not configured" message).
export async function uploadImage(file, folder = 'products') {
  const presign = await api.mediaFiles.presign({
    filename: file.name,
    contentType: file.type,
    folder,
  });
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`העלאה ל-R2 נכשלה (${put.status})`);
  }
  return api.mediaFiles.create({
    key: presign.key,
    url: presign.publicUrl,
    bucket: presign.bucket,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
}

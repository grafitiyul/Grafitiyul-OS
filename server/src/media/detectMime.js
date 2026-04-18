// Magic-number sniffing for the file formats we accept. We NEVER trust the
// browser-reported Content-Type alone. The stored MIME is whatever detectMime
// returns (or we reject the upload).
//
// References: RFC 2045 (MIME), libmagic, WHATWG mime sniffing standard.
// Only bytes [0..11] are inspected — enough for every format in our allow list.

export function detectMime(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF: "GIF87a" or "GIF89a"
  if (
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return 'image/gif';
  }

  // WebP: "RIFF" …… "WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }

  // WebM / Matroska EBML: 1A 45 DF A3
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return 'video/webm';
  }

  // Ogg: "OggS"
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) {
    return 'video/ogg';
  }

  // ISO BMFF (MP4 / MOV / 3GP family): "ftyp" at offset 4, brand at offset 8.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand.startsWith('qt')) return 'video/quicktime';
    // isom, iso2, mp41, mp42, avc1, dash, M4V, M4A, 3gp*, etc → treat as mp4.
    return 'video/mp4';
  }

  return null;
}

export function kindOfMime(mime) {
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

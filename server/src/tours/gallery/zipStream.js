// Dependency-free streaming ZIP writer — STORE only (media is already
// compressed; deflating photos/videos wastes CPU for ~0%). Built for the
// gallery "download all" export: entries stream one at a time from R2, CRC32
// is computed on the fly, and output flows straight into a multipart R2
// upload — memory stays flat no matter how large the gallery is.
//
// Format notes (PKWARE APPNOTE):
//   * every entry uses the bit-3 data descriptor (CRC unknown until the
//     bytes streamed) + bit-11 (UTF-8 names — Hebrew filenames);
//   * an entry declared big (≥4GiB) gets a ZIP64 extra in its local header,
//     which switches its data descriptor to 8-byte sizes;
//   * the central directory writes ZIP64 extras per field only when a value
//     overflows, and the ZIP64 EOCD appears only when needed — small
//     archives stay plain-zip for maximum tool compatibility.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32Update(crc, buf) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32(buf) {
  return crc32Update(0, buf);
}

const ZIP64_LIMIT = 0xfffffff0; // margin below 0xFFFFFFFF

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { dosTime, dosDate };
}

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff);
  return b;
}
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(Number(v) >>> 0);
  return b;
}
function u64(v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}

// entries: async iterable of { name: string, size: number, modifiedAt?: Date,
// data: AsyncIterable<Buffer> }. Yields Buffers (the ZIP byte stream).
export async function* zipStream(entries) {
  const central = [];
  let offset = 0n;

  for await (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name), 'utf8');
    const zip64 = Number(entry.size) >= ZIP64_LIMIT;
    const { dosTime, dosDate } = dosDateTime(entry.modifiedAt);
    const localOffset = offset;

    // ZIP64 extra in the LOCAL header (zero sizes — real values come in the
    // data descriptor) signals the 8-byte descriptor format.
    const localExtra = zip64
      ? Buffer.concat([u16(0x0001), u16(16), u64(0), u64(0)])
      : Buffer.alloc(0);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(zip64 ? 45 : 20), // version needed
      u16(0x0808), // bit 3 (descriptor) + bit 11 (UTF-8)
      u16(0), // method: store
      u16(dosTime),
      u16(dosDate),
      u32(0), // crc (descriptor)
      u32(zip64 ? 0xffffffff : 0), // comp size
      u32(zip64 ? 0xffffffff : 0), // uncomp size
      u16(nameBuf.length),
      u16(localExtra.length),
      nameBuf,
      localExtra,
    ]);
    yield localHeader;
    offset += BigInt(localHeader.length);

    let crc = 0;
    let size = 0n;
    for await (const chunk of entry.data) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc = crc32Update(crc, buf);
      size += BigInt(buf.length);
      offset += BigInt(buf.length);
      yield buf;
    }

    const descriptor = zip64
      ? Buffer.concat([u32(0x08074b50), u32(crc), u64(size), u64(size)])
      : Buffer.concat([u32(0x08074b50), u32(crc), u32(Number(size)), u32(Number(size))]);
    yield descriptor;
    offset += BigInt(descriptor.length);

    central.push({ nameBuf, crc, size, localOffset, dosTime, dosDate });
  }

  // Central directory.
  const cdStart = offset;
  for (const e of central) {
    const needSizeZip64 = e.size >= BigInt(ZIP64_LIMIT);
    const needOffsetZip64 = e.localOffset >= BigInt(ZIP64_LIMIT);
    const extraParts = [];
    if (needSizeZip64) extraParts.push(u64(e.size), u64(e.size));
    if (needOffsetZip64) extraParts.push(u64(e.localOffset));
    const extra = extraParts.length
      ? Buffer.concat([u16(0x0001), u16(extraParts.length * 8), ...extraParts])
      : Buffer.alloc(0);
    const rec = Buffer.concat([
      u32(0x02014b50),
      u16(45), // version made by
      u16(needSizeZip64 || needOffsetZip64 ? 45 : 20),
      u16(0x0808),
      u16(0),
      u16(e.dosTime),
      u16(e.dosDate),
      u32(e.crc),
      u32(needSizeZip64 ? 0xffffffff : Number(e.size)),
      u32(needSizeZip64 ? 0xffffffff : Number(e.size)),
      u16(e.nameBuf.length),
      u16(extra.length),
      u16(0), // comment
      u16(0), // disk
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(needOffsetZip64 ? 0xffffffff : Number(e.localOffset)),
      e.nameBuf,
      extra,
    ]);
    yield rec;
    offset += BigInt(rec.length);
  }
  const cdSize = offset - cdStart;

  const needZip64Eocd =
    central.length > 0xffff || cdStart >= BigInt(ZIP64_LIMIT) || cdSize >= BigInt(ZIP64_LIMIT);
  if (needZip64Eocd) {
    const eocd64 = Buffer.concat([
      u32(0x06064b50),
      u64(44), // size of remaining record
      u16(45),
      u16(45),
      u32(0),
      u32(0),
      u64(central.length),
      u64(central.length),
      u64(cdSize),
      u64(cdStart),
    ]);
    yield eocd64;
    const locator = Buffer.concat([u32(0x07064b50), u32(0), u64(offset), u32(1)]);
    yield locator;
    offset += BigInt(eocd64.length + locator.length);
  }
  yield Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(needZip64Eocd ? 0xffff : central.length),
    u16(needZip64Eocd ? 0xffff : central.length),
    u32(needZip64Eocd ? 0xffffffff : Number(cdSize)),
    u32(needZip64Eocd ? 0xffffffff : Number(cdStart)),
    u16(0),
  ]);
}

// De-duplicate download names inside one archive: "a.jpg", "a (2).jpg", …
export function uniqueZipNames(names) {
  const seen = new Map();
  return names.map((raw) => {
    const name = String(raw || 'file');
    const count = seen.get(name.toLowerCase()) || 0;
    seen.set(name.toLowerCase(), count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0
      ? `${name.slice(0, dot)} (${count + 1})${name.slice(dot)}`
      : `${name} (${count + 1})`;
  });
}

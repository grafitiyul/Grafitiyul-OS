import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, uniqueZipNames, zipStream } from './zipStream.js';

// The export zipper must produce archives real tools open. These tests parse
// the produced bytes with an independent minimal reader (EOCD → central
// directory → local entries → data) and verify structure, names, bytes and
// CRCs end-to-end.

async function collect(genOrIterable) {
  const chunks = [];
  for await (const c of genOrIterable) chunks.push(c);
  return Buffer.concat(chunks);
}

async function* asEntries(files) {
  for (const f of files) {
    yield {
      name: f.name,
      size: f.data.length,
      modifiedAt: new Date('2026-07-14T10:00:00'),
      data: (async function* gen() {
        // split into small chunks to exercise streaming CRC/size accounting
        for (let i = 0; i < f.data.length; i += 3) yield f.data.subarray(i, i + 3);
      })(),
    };
  }
}

// Minimal store-only unzip: locate EOCD, walk the central directory, read
// each entry's bytes via its local header.
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, 'EOCD found');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header sig');
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    // read via local header
    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, 'local header sig');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries.push({ name, crc, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('zip roundtrip: names, bytes and CRCs all survive (UTF-8 Hebrew names included)', async () => {
  const files = [
    { name: 'IMG_0001.jpg', data: Buffer.from('hello world, this is a fake jpeg payload') },
    { name: 'סיור בתל אביב.mp4', data: Buffer.from([0, 1, 2, 3, 4, 5, 250, 251, 252]) },
    { name: 'empty.png', data: Buffer.alloc(0) },
  ];
  const zip = await collect(zipStream(asEntries(files)));
  const out = unzip(zip);
  assert.equal(out.length, 3);
  for (let i = 0; i < files.length; i += 1) {
    assert.equal(out[i].name, files[i].name);
    assert.ok(out[i].data.equals(files[i].data), `bytes of ${files[i].name}`);
    assert.equal(out[i].crc, crc32(files[i].data), `crc of ${files[i].name}`);
  }
});

test('zip: data descriptors present (streaming mode) and archive ends with EOCD', async () => {
  const zip = await collect(
    zipStream(asEntries([{ name: 'a.bin', data: Buffer.from('abc') }])),
  );
  // descriptor signature exists after the entry data
  let found = false;
  for (let i = 0; i < zip.length - 4; i += 1) {
    if (zip.readUInt32LE(i) === 0x08074b50) found = true;
  }
  assert.ok(found, 'data descriptor written');
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'EOCD is the tail record');
});

test('crc32 known vectors', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('duplicate filenames inside one archive get numbered, extension preserved', () => {
  assert.deepEqual(uniqueZipNames(['a.jpg', 'a.jpg', 'b.mp4', 'A.JPG', 'noext']), [
    'a.jpg',
    'a (2).jpg',
    'b.mp4',
    'A (3).JPG',
    'noext',
  ]);
});

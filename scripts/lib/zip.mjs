import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

export async function collectFiles(root, includes, excludes = []) {
  const found = new Map();
  const excluded = (relative) => excludes.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));

  async function visit(relative) {
    if (excluded(relative)) return;
    const absolute = path.join(root, relative);
    const metadata = await stat(absolute);
    if (metadata.isDirectory()) {
      const entries = await readdir(absolute);
      for (const entry of entries.sort()) await visit(path.posix.join(relative.replaceAll('\\', '/'), entry));
      return;
    }
    if (metadata.isFile()) found.set(relative.replaceAll('\\', '/'), { absolute, mode: metadata.mode & 0o777 });
  }

  for (const include of includes) await visit(include);
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export async function createZip(outputPath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, source] of entries) {
    const data = source.data === undefined ? await readFile(source.absolute) : Buffer.from(source.data);
    const nameBuffer = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const flags = 0x0800;
    const mode = (source.mode || 0o644) & 0xffff;

    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(0), u16(0), u16(0x21),
      u32(checksum), u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), nameBuffer
    ]);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(0x031e), u16(20), u16(flags), u16(0), u16(0), u16(0x21),
      u32(checksum), u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), u16(0),
      u16(0), u16(0), u32(mode << 16), u32(offset), nameBuffer
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0)
  ]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.concat([...localParts, central, end]));
  return outputPath;
}

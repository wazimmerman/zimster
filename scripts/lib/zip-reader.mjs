import { readFile } from 'node:fs/promises';
import { crc32 } from './zip.mjs';

export function archivePathProblem(name) {
  if (!name || name.includes('\\')) return 'empty or backslash archive path';
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return 'absolute archive path';
  const parts = name.split('/');
  if (parts.some((part) => part === '..')) return 'archive path traversal';
  if (parts.some((part) => part === '')) return 'empty archive path segment';
  return null;
}

export async function readStoredZip(file) {
  const archive = await readFile(file);
  const entries = [];
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > archive.length) throw new Error('truncated ZIP local header');
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const checksum = archive.readUInt32LE(offset + 14);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const size = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    if ((flags & 0x0001) !== 0) throw new Error('encrypted ZIP entries are unsupported');
    if (method !== 0 || compressedSize !== size) throw new Error('only stored ZIP entries are supported');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new Error('truncated ZIP entry data');
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const data = archive.subarray(dataStart, dataEnd);
    if (crc32(data) !== checksum) throw new Error(`ZIP checksum mismatch for ${name}`);
    entries.push({ name, data });
    offset = dataEnd;
  }
  if (!entries.length) throw new Error('ZIP contains no stored file entries');
  return entries;
}

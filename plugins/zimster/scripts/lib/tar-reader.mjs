import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

function text(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
}

export async function readTarGzip(file) {
  const archive = gunzipSync(await readFile(file));
  const entries = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = text(header, 0, 100);
    const prefix = text(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = text(header, 124, 12).trim();
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid tar size for ${fullName}`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new Error(`truncated tar entry ${fullName}`);
    entries.push({ name: fullName, data: archive.subarray(dataStart, dataEnd) });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

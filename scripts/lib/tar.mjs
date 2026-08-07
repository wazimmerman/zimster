import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

function field(header, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new Error(`tar field is too long: ${value}`);
  bytes.copy(header, offset);
}

function octal(header, offset, length, value) {
  field(header, offset, length, value.toString(8).padStart(length - 1, '0'));
}

function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  const split = name.lastIndexOf('/');
  if (split <= 0) throw new Error(`tar path is too long: ${name}`);
  const prefix = name.slice(0, split);
  const basename = name.slice(split + 1);
  if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(basename) > 100) {
    throw new Error(`tar path is too long: ${name}`);
  }
  return { name: basename, prefix };
}

async function archiveEntry(relative, source) {
  const data = source.data === undefined ? await readFile(source.absolute) : Buffer.from(source.data);
  const header = Buffer.alloc(512);
  const pathname = splitName(`package/${relative}`);
  field(header, 0, 100, pathname.name);
  octal(header, 100, 8, (source.mode || 0o644) & 0o777);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, data.length);
  octal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  field(header, 257, 6, 'ustar\0');
  field(header, 263, 2, '00');
  field(header, 345, 155, pathname.prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  field(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return [header, data, padding];
}

export async function createTarGzip(outputPath, entries) {
  const parts = [];
  for (const [relative, source] of entries) parts.push(...await archiveEntry(relative, source));
  parts.push(Buffer.alloc(1024));
  const archive = gzipSync(Buffer.concat(parts), { level: 9, mtime: 0 });
  await writeFile(outputPath, archive);
  return outputPath;
}

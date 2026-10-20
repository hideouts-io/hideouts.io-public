/** Regenerate the website icons from the approved SVGs in public/branding/hideouts and public/favicon.svg. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

type IconExport = { readonly source: string; readonly destination: string; readonly size: number };
type IconFrame = { readonly size: number; readonly png: Buffer };

const PUBLIC: string = fileURLToPath(new URL('../public/', import.meta.url));
const BRAND: string = 'branding/hideouts';
const exports: readonly IconExport[] = [
  { source: `${BRAND}/apple-touch-icon.svg`, destination: 'apple-touch-icon.png', size: 180 },
  { source: 'favicon.svg', destination: 'favicon-16.png', size: 16 },
  { source: 'favicon.svg', destination: 'favicon-32.png', size: 32 },
  { source: `${BRAND}/app-icon.svg`, destination: 'icons/icon-192.png', size: 192 },
  { source: `${BRAND}/app-icon.svg`, destination: 'icons/icon-512.png', size: 512 },
  { source: `${BRAND}/icon-maskable.svg`, destination: 'icons/icon-maskable-512.png', size: 512 },
];

/** Match the approved package's SVG rasterization and preserve its padding. */
async function renderPng(source: string, size: number): Promise<Buffer> {
  return sharp(source, { density: 72 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Encode PNG frames in the ICO directory format, including the 256 px frame's zero size byte. */
function encodeIco(frames: readonly IconFrame[]): Buffer {
  const header: Buffer = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries: Buffer[] = frames.map((frame, index) => {
    const entry: Buffer = Buffer.alloc(16);
    entry.writeUInt8(frame.size === 256 ? 0 : frame.size, 0);
    entry.writeUInt8(frame.size === 256 ? 0 : frame.size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(frame.png.length, 8);
    const precedingBytes: number = frames.slice(0, index).reduce((sum, previous) => sum + previous.png.length, 0);
    entry.writeUInt32LE(6 + frames.length * 16 + precedingBytes, 12);
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)]);
}

await mkdir(join(PUBLIC, 'icons'), { recursive: true });
for (const icon of exports) {
  await writeFile(join(PUBLIC, icon.destination), await renderPng(join(PUBLIC, icon.source), icon.size));
}
const frames: IconFrame[] = await Promise.all(
  [16, 32, 48, 64, 128, 256].map(async (size: number): Promise<IconFrame> => ({
    size,
    png: await renderPng(join(PUBLIC, 'favicon.svg'), size),
  })),
);
await writeFile(join(PUBLIC, 'favicon.ico'), encodeIco(frames));
console.log(
  JSON.stringify({ event: 'icons_written', files: [...exports.map((icon) => icon.destination), 'favicon.ico'] }),
);

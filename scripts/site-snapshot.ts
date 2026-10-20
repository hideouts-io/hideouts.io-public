import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SnapshotFile = { path: string; size: number; sha256: string };

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = join(ROOT, 'site-snapshot/manifest.txt');
const SNAPSHOT_DIRS = ['src/generated', 'public/media', 'public/og', 'site-snapshot/pages'];
export const PAGE_TARGETS = [
  ['home', 'dist/index.html'],
  ['drivetrace', 'dist/apps/drivetrace/index.html'],
  ['entitlementlens', 'dist/apps/entitlementlens/index.html'],
  ['interface-sentinel', 'dist/apps/interface-sentinel/index.html'],
  ['ios-developer-toolkit-swift', 'dist/apps/ios-developer-toolkit-swift/index.html'],
  ['ios-developer-toolkit', 'dist/apps/ios-developer-toolkit/index.html'],
  ['macscope', 'dist/apps/macscope/index.html'],
  ['man-pages-catalog', 'dist/apps/man-pages-catalog/index.html'],
  ['rvi-correlator', 'dist/apps/rvi-correlator/index.html'],
  ['rvi-sentinel-swift', 'dist/apps/rvi-sentinel-swift/index.html'],
  ['rvi-sentinel', 'dist/apps/rvi-sentinel/index.html'],
  ['sandbox-lens', 'dist/apps/sandbox-lens/index.html'],
  ['system-profiler-explorer', 'dist/apps/system-profiler-explorer/index.html'],
  ['volume-mount-troubleshooter', 'dist/apps/volume-mount-troubleshooter/index.html'],
] as const;

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validSnapshotPath(path: string): boolean {
  return (
    /^src\/generated\/[a-z0-9-]+\.json$/.test(path) ||
    /^public\/media\/[a-z0-9-]+\/[a-zA-Z0-9_.-]+\.(?:webp|svg)$/.test(path) ||
    /^public\/og\/[a-z0-9-]+\.png$/.test(path) ||
    /^site-snapshot\/pages\/[a-z0-9-]+\.main\.html$/.test(path) ||
    path === 'src/styles/shiki.generated.css'
  );
}

function parseManifest(text: string): SnapshotFile[] {
  if (!text.endsWith('\n')) throw new Error('Site snapshot manifest must end with a newline');
  const rows = text.trimEnd().split('\n');
  const files = rows.map((row) => {
    const match = /^([a-f0-9]{64}) ([0-9]+) (.+)$/.exec(row);
    if (!match || !validSnapshotPath(match[3])) throw new Error(`Invalid site snapshot manifest row: ${row}`);
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid site snapshot size: ${match[3]}`);
    return { sha256: match[1], size, path: match[3] };
  });
  const paths = files.map((file) => file.path);
  if (paths.join('\n') !== [...new Set(paths)].sort().join('\n')) {
    throw new Error('Site snapshot manifest paths must be unique and sorted');
  }
  const count = (prefix: string): number => paths.filter((path) => path.startsWith(prefix)).length;
  if (
    files.length !== 356 ||
    count('src/generated/') !== 19 ||
    count('public/media/') !== 303 ||
    count('public/og/') !== 19 ||
    count('site-snapshot/pages/') !== PAGE_TARGETS.length ||
    !paths.includes('src/styles/shiki.generated.css') ||
    PAGE_TARGETS.some(([slug]) => !paths.includes(`site-snapshot/pages/${slug}.main.html`))
  ) {
    throw new Error('Site snapshot manifest has an unexpected file set');
  }
  return files;
}

async function listFiles(directory: string): Promise<string[]> {
  const folder = join(ROOT, directory);
  const mode = await lstat(folder);
  if (!mode.isDirectory() || mode.isSymbolicLink()) throw new Error(`Invalid site snapshot directory: ${directory}`);
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Site snapshot contains a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Site snapshot contains an unsupported entry: ${path}`);
  }
  return files;
}

export async function verifySnapshot(): Promise<SnapshotFile[]> {
  const manifest = parseManifest(await readFile(MANIFEST, 'utf8'));
  const actual = (await Promise.all(SNAPSHOT_DIRS.map(listFiles))).flat();
  actual.push('src/styles/shiki.generated.css');
  const expected = manifest.map((file) => file.path);
  if (actual.sort().join('\n') !== expected.join('\n')) {
    throw new Error('Site snapshot files differ from the manifest');
  }
  for (const file of manifest) {
    const location = join(ROOT, file.path);
    const mode = await lstat(location);
    if (!mode.isFile() || mode.isSymbolicLink()) throw new Error(`Invalid site snapshot file: ${file.path}`);
    const bytes = await readFile(location);
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
      throw new Error(`Site snapshot digest mismatch: ${file.path}`);
    }
  }
  return manifest;
}

import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, PAGE_TARGETS, sha256, verifySnapshot, type SnapshotFile } from './site-snapshot.ts';

const MAIN_OPEN = '<main id="main" class="flex-1">';
const MAIN_CLOSE = '</main>';

function mainRange(html: string, path: string): [number, number] {
  const start = html.indexOf(MAIN_OPEN);
  const close = html.indexOf(MAIN_CLOSE, start + MAIN_OPEN.length);
  if (
    start < 0 ||
    close < 0 ||
    html.indexOf(MAIN_OPEN, start + MAIN_OPEN.length) >= 0 ||
    html.indexOf(MAIN_CLOSE, close + MAIN_CLOSE.length) >= 0
  ) {
    throw new Error(`Expected one page main element: ${path}`);
  }
  return [start, close + MAIN_CLOSE.length];
}

async function verifyOutputAssets(manifest: SnapshotFile[]): Promise<void> {
  for (const group of ['media', 'og']) {
    const source = manifest.filter((file) => file.path.startsWith(`public/${group}/`));
    const output = (await listOutputFiles(`dist/${group}`)).sort();
    const expected = source.map((file) => file.path.replace(/^public\//, 'dist/'));
    if (output.join('\n') !== expected.join('\n')) {
      throw new Error(`Built ${group} files differ from the site snapshot`);
    }
    for (const file of source) {
      const outputPath = file.path.replace(/^public\//, 'dist/');
      const bytes = await readFile(join(ROOT, outputPath));
      if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
        throw new Error(`Built asset digest mismatch: ${outputPath}`);
      }
    }
  }
}

async function listOutputFiles(directory: string): Promise<string[]> {
  const folder = join(ROOT, directory);
  const mode = await lstat(folder);
  if (!mode.isDirectory() || mode.isSymbolicLink()) throw new Error(`Invalid built asset directory: ${directory}`);
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Built asset contains a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...(await listOutputFiles(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Built asset contains an unsupported entry: ${path}`);
  }
  return files;
}

async function applySnapshot(): Promise<void> {
  const manifest = await verifySnapshot();
  await verifyOutputAssets(manifest);
  const pages: { path: string; html: string }[] = [];
  for (const [slug, path] of PAGE_TARGETS) {
    const html = await readFile(join(ROOT, path), 'utf8');
    const fragment = await readFile(join(ROOT, `site-snapshot/pages/${slug}.main.html`), 'utf8');
    const [fragmentStart, fragmentEnd] = mainRange(fragment, `${slug} snapshot`);
    if (
      fragmentStart !== 0 ||
      fragmentEnd !== fragment.length ||
      /<\/?(?:script|style|iframe|object|embed|head|footer|html|body)\b/i.test(fragment) ||
      /https:\/\/github\.com\/hideouts-io\/hideouts\.io(?:\/|["'#?])/i.test(fragment)
    ) {
      throw new Error(`Invalid reviewed page fragment: ${slug}`);
    }
    const [start, end] = mainRange(html, path);
    pages.push({ path, html: `${html.slice(0, start)}${fragment}${html.slice(end)}` });
  }
  for (const page of pages) await writeFile(join(ROOT, page.path), page.html);
  console.log(`Verified ${manifest.length} pinned site files and applied ${pages.length} reviewed page fragments`);
}

await applySnapshot();

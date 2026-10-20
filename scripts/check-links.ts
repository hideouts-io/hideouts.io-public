/**
 * Offline link check for dist/: every internal href/src must resolve to a
 * built file, and every #fragment must exist on its target page.
 * External links are checked separately in CI with lychee.
 *
 *   node scripts/check-links.ts
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSources } from '../src/lib/image-sources.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

async function* html(dir: string): AsyncGenerator<string> {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) yield* html(p);
    else if (d.name.endsWith('.html')) yield p;
  }
}

const idCache = new Map<string, Set<string>>();
async function ids(file: string) {
  if (!idCache.has(file)) {
    const text = await readFile(file, 'utf8');
    idCache.set(file, new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idCache.get(file)!;
}

async function resolve(urlPath: string): Promise<string | null> {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  const candidates = clean.endsWith('/')
    ? [join(DIST, clean, 'index.html')]
    : [join(DIST, clean), join(DIST, clean, 'index.html'), join(DIST, clean + '.html')];
  for (const c of candidates) {
    try {
      if ((await stat(c)).isFile()) return c;
    } catch {
      // Not this candidate; try the next.
    }
  }
  return null;
}

const problems: string[] = [];
let checked = 0;
for await (const file of html(DIST)) {
  const text = await readFile(file, 'utf8');
  const page = '/' + relative(DIST, dirname(file)).split('\\').join('/') + '/';
  const references = [
    ...[...text.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((match) => match[1]),
    ...[...text.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((match) => imageSources(match[1]).map((source) => source.src)),
  ];
  for (const reference of references) {
    const raw = reference.replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|data:|tel:)/i.test(raw)) continue;
    checked++;
    const [pathPart, frag] = raw.split('#');
    const target = pathPart ? await resolve(new URL(pathPart, `https://x${page}`).pathname) : file;
    if (!target) {
      problems.push(`${relative(ROOT, file)} → ${raw} (missing)`);
      continue;
    }
    if (frag && target.endsWith('.html') && !(await ids(target)).has(decodeURIComponent(frag))) {
      problems.push(`${relative(ROOT, file)} → ${raw} (no #${frag})`);
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} broken internal link(s):\n  ` + [...new Set(problems)].join('\n  '));
  process.exit(1);
}
console.log(`✓ ${checked} internal links and anchors resolve`);

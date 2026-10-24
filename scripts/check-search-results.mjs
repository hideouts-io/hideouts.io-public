import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { searchResultKind } from '../src/lib/search-result-kind.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const originalFetch = globalThis.fetch;

// Pagefind's own generated runtime reads its real index files through file URLs in Node.
globalThis.fetch = async (input) => {
  const address = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (address.protocol !== 'file:') throw new Error('Search smoke check requested a nonlocal resource');
  return new Response(await readFile(fileURLToPath(address)));
};

try {
  const pagefind = await import(pathToFileURL(join(output, 'pagefind/pagefind.js')).href);
  await pagefind.init();
  const { results } = await pagefind.search('app');
  assert.ok(results.length > 0, 'The built search index has no results');
  const kinds = new Set();

  for (const result of results) {
    const data = await result.data();
    const marker = '/dist/';
    const start = data.url.lastIndexOf(marker);
    assert.ok(start >= 0, 'A search result is outside the built site');
    const route = data.url.slice(start + '/dist'.length);
    assert.match(route, /^\/(?:apps|research)\/[a-z0-9-]+\/$/, 'Unexpected search result route');
    assert.ok((await stat(join(output, route, 'index.html'))).isFile(), 'Search result page is missing');
    assert.equal(data.filters?.kind, undefined, 'The search index retained an unused kind filter');
    kinds.add(searchResultKind(route));
  }

  assert.ok(kinds.has('App'), 'The search index has no app result');
  assert.ok(kinds.has('Research'), 'The search index has no research result');
  assert.ok((await stat(join(output, 'colophon/index.html'))).isFile(), 'The general page is missing');
  assert.equal(searchResultKind('/colophon/'), 'Page');
  console.log(`Search result labels passed for ${results.length} built results and a general page`);
} finally {
  globalThis.fetch = originalFetch;
}

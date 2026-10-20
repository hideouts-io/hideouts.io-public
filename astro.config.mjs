// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, readFileSync } from 'node:fs';
import { CSP_DIRECTIVES, CSP_SCRIPT_RESOURCES } from './src/data/csp.ts';
import { PROJECTS } from './src/data/projects.ts';

// Sitemap <lastmod>: a project page changes when its repository does, so use the
// last commit date `npm run content` recorded. Index pages take their newest
// project's date. Other pages get no <lastmod> rather than a made-up one.
function lastModified() {
  const dir = new URL('./src/generated/', import.meta.url);
  /** @type {Record<string, string>} */
  const byPath = {};
  /** @type {string[]} */
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return byPath;
  }
  /** @param {string | undefined} a @param {string} b */
  const newest = (a, b) => (!a || b > a ? b : a);
  for (const f of files) {
    const g = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    const project = PROJECTS.find((p) => p.slug === g.slug);
    if (!project) continue;
    const section = project.kind === 'research' ? 'research' : 'apps';
    byPath[`/${section}/${g.slug}/`] = g.updatedAt;
    byPath[`/${section}/`] = newest(byPath[`/${section}/`], g.updatedAt);
    byPath['/'] = newest(byPath['/'], g.updatedAt);
  }
  return byPath;
}
const LASTMOD = lastModified();

// https://astro.build/config
export default defineConfig({
  site: 'https://hideouts.io',
  trailingSlash: 'always',
  redirects: { '/apps/drive-explorer/': '/apps/drivetrace/' },
  integrations: [
    sitemap({
      serialize(item) {
        const date = LASTMOD[new URL(item.url).pathname];
        return date ? { ...item, lastmod: date } : item;
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
  // README code is highlighted at content-render time (scripts/render-content.ts)
  // with CSS classes. Astro's own Markdown highlighter is unused, and its inline
  // styles would conflict with the CSP, so turn it off.
  markdown: { syntaxHighlight: false },
  security: {
    // Astro hashes every script and style it emits into a <meta> CSP.
    // The policy itself lives in src/data/csp.ts.
    csp: {
      algorithm: 'SHA-256',
      scriptDirective: { resources: [...CSP_SCRIPT_RESOURCES] },
      directives: [...CSP_DIRECTIVES],
    },
  },
});

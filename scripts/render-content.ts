/**
 * Step 2 of the content pipeline: turn the cached GitHub data into
 * site-ready JSON, images, diagrams, and syntax-highlighting CSS.
 *
 *   node scripts/render-content.ts
 *
 * Output:
 *   src/generated/<slug>.json        rendered README HTML, TOC, hero data
 *   public/media/<slug>/…            optimized images and Mermaid SVGs
 *   src/styles/shiki.generated.css   classes for highlighted code
 */
import { mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeShiki from '@shikijs/rehype';
import { transformerStyleToClass } from '@shikijs/transformers';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP } from 'unist-util-visit';
import { toString as hastToString } from 'hast-util-to-string';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { imageSources } from '../src/lib/image-sources.ts';
import {
  ALLOWED_REPOS,
  FORMER_REPO_NAMES,
  GITHUB_OWNER,
  INFRA_REPOS,
  PROJECTS,
  byRepo,
  type Project,
} from '../src/data/projects.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, '.cache/github');
const OUT_JSON = join(ROOT, 'src/generated');
const OUT_MEDIA = join(ROOT, 'public/media');

const styleToClass = transformerStyleToClass({ classPrefix: 'sk-' });

// ─── Markdown pre-processing ────────────────────────────────────────────────

const BADGE_RE = /(img\.shields\.io|badge\.svg|badgen\.net|\/workflows\/.+\/badge)/i;
const BADGE_TOKEN = /\[?!\[[^\]]*\]\([^)]*\)\]?(\([^)]*\))?/g;

function stripBadgeLines(md: string) {
  return md
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t || !BADGE_RE.test(t)) return true;
      // Drop the line only if it is made of badge images and nothing else.
      return (
        t
          .replace(BADGE_TOKEN, '')
          .replace(/<[^>]+>/g, '')
          .trim() !== ''
      );
    })
    .join('\n');
}

/** Remove the README's own table of contents; the site builds its own. */
function stripToc(md: string) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{1,3}\s+(?:[^\w\s]+\s*)?(table of contents|contents)\s*$/i.test(l.trim()));
  if (start < 0) return md;
  const level = lines[start].match(/^#+/)![0].length;
  let end = start + 1;
  while (end < lines.length) {
    const h = lines[end].match(/^(#+)\s/);
    if (h && h[1].length <= level) break;
    if (lines[end].trim() === '---' && end > start + 1) {
      end++;
      break;
    }
    end++;
  }
  lines.splice(start, end - start);
  return lines.join('\n');
}

/** Remove whole sections by heading text (heading line through the next heading of the same or higher level). */
function stripSections(md: string, names: string[] = []) {
  for (const name of names) {
    const lines = md.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${escapeRe(name)}\\s*$`, 'i').test(l.trim()));
    if (start < 0) {
      console.warn(`  ! stripSections: heading "${name}" not found`);
      continue;
    }
    const level = lines[start].match(/^#+/)![0].length;
    let end = start + 1;
    while (end < lines.length && !(lines[end].match(/^(#+)\s/) && lines[end].match(/^(#+)/)![1].length <= level)) end++;
    lines.splice(start, end - start);
    md = lines.join('\n');
  }
  return md;
}

/** Pull the "> **Scope:** …" blockquote out so the page can feature it. */
function extractScope(md: string): { md: string; scope: string | null } {
  const m = md.match(/^> \*\*Scope:\*\*\s*([\s\S]*?)(?=\n(?!>)|$)/m);
  if (!m) return { md, scope: null };
  const scope = m[1].replace(/\n>\s?/g, ' ').trim();
  return { md: md.replace(m[0], ''), scope };
}

/** Find a logo near the top and remove its block from the body. */
function extractLogo(md: string, images: Meta['images']): { md: string; logo: string | null } {
  const head = md.split('\n').slice(0, 25).join('\n');
  const candidates = [
    ...head.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi),
    ...head.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g),
  ];
  for (const c of candidates) {
    const src = c[1];
    const tag = c[0];
    if (!/logo|appicon|icon/i.test(src + tag) || !images[src]) continue;
    const picture = [...md.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi)].find(
      (match) => match.index! <= c.index! && match.index! + match[0].length >= c.index! + tag.length,
    );
    const logoMarkup = picture ? picture[0] : tag;
    const block = new RegExp(`<p[^>]*>\\s*${escapeRe(logoMarkup)}\\s*</p>`, 'i');
    const stripped = block.test(md) ? md.replace(block, '') : md.replace(logoMarkup, '');
    return { md: stripped, logo: src };
  }
  return { md, logo: null };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** If the README uses more than one H1, treat H1s as section headings. */
function normalizeHeadings(md: string) {
  let inFence = false;
  const lines = md.split('\n');
  const h1s = lines.filter((l) => {
    if (/^```/.test(l)) inFence = !inFence;
    return !inFence && /^# /.test(l);
  }).length;
  // Remove the title H1 (the page renders its own).
  inFence = false;
  let removed = false;
  const out = lines.filter((l) => {
    if (/^```/.test(l)) inFence = !inFence;
    if (!removed && !inFence && /^# /.test(l)) {
      removed = true;
      return false;
    }
    return true;
  });
  // A "### subtitle" before the first section repeats the curated tagline.
  const firstH2 = out.findIndex((l) => /^## /.test(l));
  const sub = out.findIndex((l) => /^### /.test(l));
  if (sub >= 0 && (firstH2 < 0 || sub < firstH2) && sub < 30) out.splice(sub, 1);
  if (h1s <= 1) return out.join('\n');
  inFence = false;
  return out
    .map((l) => {
      if (/^```/.test(l)) inFence = !inFence;
      return !inFence && /^#{1,5} /.test(l) ? '#' + l : l;
    })
    .join('\n');
}

// ─── Images ────────────────────────────────────────────────────────────────

interface Img {
  src: string;
  width?: number;
  height?: number;
  srcset?: string;
}

const WIDTHS = [640, 1200, 2000];
/** README content column is at most 48rem; screenshots fill it on desktop. */
const README_SIZES = '(min-width: 1024px) 768px, calc(100vw - 2rem)';

/** Intrinsic size of an SVG from width/height attributes or its viewBox. */
function svgSize(svg: string): { width?: number; height?: number } {
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const num = (a: string) => {
    const m = tag.match(new RegExp(`\\s${a}=["']([\\d.]+)(px)?["']`, 'i'));
    return m ? Math.round(Number(m[1])) : undefined;
  };
  let width = num('width');
  let height = num('height');
  const vb = tag.match(/viewBox=["'][\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)["']/i);
  if ((!width || !height) && vb) {
    width = Math.round(Number(vb[1]));
    height = Math.round(Number(vb[2]));
  }
  return { width, height };
}

// ─── Code blocks ────────────────────────────────────────────────────────────

/** Languages shown in a terminal-style frame. */
const TERMINAL_LANGS = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'shellsession', 'powershell', 'ps1', 'pwsh']);
/** Friendlier labels for the code-block bar; anything else shows its language id. */
const LANG_LABELS: Record<string, string> = {
  sh: 'Terminal',
  bash: 'Terminal',
  zsh: 'Terminal',
  shell: 'Terminal',
  console: 'Terminal',
  shellsession: 'Terminal',
  powershell: 'PowerShell',
  ps1: 'PowerShell',
  pwsh: 'PowerShell',
  json: 'JSON',
  xml: 'XML',
  python: 'Python',
};

/**
 * True when a logo is a shape of its own (a circle, a badge) rather than a
 * full square: all four corners are transparent. Such logos are shown as-is,
 * without the rounded tile and background behind square logos.
 */
async function isShapedLogo(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const inset = Math.max(1, Math.round(info.width * 0.02));
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  const corners = [
    [inset, inset],
    [info.width - 1 - inset, inset],
    [inset, info.height - 1 - inset],
    [info.width - 1 - inset, info.height - 1 - inset],
  ];
  return corners.every(([x, y]) => alphaAt(x, y) < 16);
}

const PUBLISHED = new Set([...ALLOWED_REPOS, ...FORMER_REPO_NAMES, ...INFRA_REPOS].map((r) => r.toLowerCase()));

/** <div class="heading-wrap"><hN id>…</hN><a class="heading-anchor" href="#id">#</a></div> */
function anchorHeading(heading: any, text: string) {
  const el = (tagName: string, properties: Record<string, unknown>, children: any[]) => ({
    type: 'element',
    tagName,
    properties,
    children,
  });
  return el('div', { className: ['heading-wrap', `level-${heading.tagName[1]}`] }, [
    heading,
    el('a', { className: ['heading-anchor'], href: `#${heading.properties.id}`, dataPagefindIgnore: '' }, [
      el('span', { ariaHidden: 'true' }, [{ type: 'text', value: '#' }]),
      el('span', { className: ['sr-only'] }, [{ type: 'text', value: `Link to section: ${text}` }]),
    ]),
  ]);
}

// ─── Rendering ──────────────────────────────────────────────────────────────

interface Meta {
  slug: string;
  repo: string;
  defaultBranch: string;
  images: Record<string, { file: string; repoPath?: string }>;
  [k: string]: any;
}

const schema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...(defaultSchema.tagNames ?? []), 'picture', 'source', 'figure', 'figcaption'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'align'],
    code: [['className', /^language-./]],
    img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height', 'alt', 'title'],
  },
};

async function renderProject(p: Project) {
  const dir = join(CACHE, p.slug);
  const meta: Meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
  let md = await readFile(join(dir, 'README.md'), 'utf8');
  const mediaDir = join(OUT_MEDIA, p.slug);
  await rm(mediaDir, { recursive: true, force: true });
  await mkdir(mediaDir, { recursive: true });

  // Optimize images: raster → responsive WebP set (640/1200/2000px); SVG and GIF
  // copied as-is. Every image gets intrinsic width/height to prevent layout shift.
  const imageUrl: Record<string, Img> = {};
  for (const [ref, { file }] of Object.entries(meta.images)) {
    const input = join(dir, 'images', file);
    if (extname(file) === '.svg' || extname(file) === '.gif') {
      await copyFile(input, join(mediaDir, file));
      const dims = extname(file) === '.svg' ? svgSize(await readFile(input, 'utf8')) : await sharp(input).metadata();
      imageUrl[ref] = { src: `/media/${p.slug}/${file}`, width: dims.width, height: dims.height };
      continue;
    }
    const base = file.replace(/\.\w+$/, '');
    const { width: origW = 2000 } = await sharp(input).metadata();
    const widths = [...new Set([...WIDTHS.filter((w) => w < origW), Math.min(origW, 2000)])].sort((a, b) => a - b);
    const variants: { url: string; w: number; h: number }[] = [];
    for (const w of widths) {
      const name = w === widths.at(-1) ? `${base}.webp` : `${base}-${w}.webp`;
      const info = await sharp(input).resize({ width: w }).webp({ quality: 84 }).toFile(join(mediaDir, name));
      variants.push({ url: `/media/${p.slug}/${name}`, w: info.width, h: info.height });
    }
    const full = variants.at(-1)!;
    imageUrl[ref] = {
      src: full.url,
      width: full.w,
      height: full.h,
      srcset: variants.length > 1 ? variants.map((v) => `${v.url} ${v.w}w`).join(', ') : undefined,
    };
  }

  md = stripBadgeLines(md);
  md = stripToc(md);
  md = stripSections(md, p.stripSections);
  const scoped = extractScope(md);
  md = scoped.md;
  const logoed = extractLogo(md, meta.images);
  md = logoed.md;
  md = normalizeHeadings(md);

  // Mermaid → static SVG files (light and dark), no client JavaScript.
  let diagram = 0;
  const diagrams: string[] = [];
  const diagramSize: Record<number, { width?: number; height?: number }> = {};
  const mermaidRe = /```mermaid\s*\n([\s\S]*?)```/g;
  for (const m of md.matchAll(mermaidRe)) {
    const i = ++diagram;
    try {
      for (const mode of ['light', 'dark'] as const) {
        const colors =
          mode === 'dark'
            ? { bg: '#0f1216', fg: '#e7eaee', accent: '#5eead4', border: '#2a313a', surface: '#161b21' }
            : { bg: '#ffffff', fg: '#1b1f24', accent: '#0f766e', border: '#d5dbe1', surface: '#f5f7f9' };
        let svg = renderMermaidSVG(m[1], {
          ...colors,
          transparent: true,
          font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, sans-serif',
        });
        svg = svg.replace(/@import url\([^)]*\);?/g, '');
        await writeFile(join(mediaDir, `diagram-${i}-${mode}.svg`), svg);
        diagramSize[i] = svgSize(svg);
      }
      diagrams.push(`diagram-${i}`);
    } catch (err) {
      console.warn(`  ! mermaid diagram ${i} in ${p.repo} failed: ${(err as Error).message}`);
      diagrams.push('');
    }
  }
  let d = 0;
  md = md.replace(mermaidRe, (whole) => {
    const id = diagrams[d++];
    if (!id) return whole;
    const { width = '', height = '' } = diagramSize[d] ?? {};
    const dims = width && height ? ` width="${width}" height="${height}"` : '';
    return `\n<figure class="diagram"><img class="diagram-light" src="/media/${p.slug}/${id}-light.svg" alt="Diagram"${dims}><img class="diagram-dark" src="/media/${p.slug}/${id}-dark.svg" alt="Diagram"${dims}></figure>\n`;
  });

  const toc: { depth: number; id: string; text: string }[] = [];
  const gallery: (Img & { alt: string; shot: boolean })[] = [];
  const blobBase = `https://github.com/${GITHUB_OWNER}/${meta.repo}/blob/${meta.defaultBranch}/`;

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema as any)
    .use(() => (tree: any) => {
      // Diagram figures survive sanitize as figure/img; tag them back.
      visit(tree, 'element', (node: any, index, parent: any) => {
        if (node.tagName === 'source' && parent?.tagName === 'picture') {
          const sources = imageSources(String(node.properties.srcSet ?? ''));
          node.properties.srcSet = sources
            .map(({ src, descriptor }) => {
              const local = imageUrl[src];
              if (!local)
                throw new Error(`${p.slug}: picture source "${src}" was not downloaded; check the README path`);
              return descriptor ? `${local.src} ${descriptor}` : (local.srcset ?? local.src);
            })
            .join(', ');
          node.properties.sizes = README_SIZES;
        }
        // Images: local copies only (CSP img-src 'self').
        if (node.tagName === 'img') {
          const src = String(node.properties.src ?? '');
          if (src.startsWith(`/media/${p.slug}/diagram-`)) {
            node.properties.className = [src.endsWith('-dark.svg') ? 'diagram-dark' : 'diagram-light'];
            node.properties.loading = 'lazy';
            if (parent?.tagName === 'figure') parent.properties.className = ['diagram'];
            return;
          }
          const local = imageUrl[src];
          if (!local || BADGE_RE.test(src)) {
            if (parent && typeof index === 'number') {
              parent.children.splice(index, 1);
              return [SKIP, index];
            }
            return;
          }
          node.properties.src = local.src;
          if (local.srcset) {
            node.properties.srcSet = local.srcset;
            node.properties.sizes = README_SIZES;
          }
          if (local.width && local.height) {
            // Keep an author-set display width, but always give the true aspect ratio.
            const w = Number(node.properties.width) || local.width;
            node.properties.width = w;
            node.properties.height = Math.round((w * local.height) / local.width);
          }
          node.properties.loading = 'lazy';
          node.properties.decoding = 'async';
          if (!node.properties.alt) node.properties.alt = '';
          if (local.width && !local.src.endsWith('.svg') && !gallery.some((g) => g.src === local.src)) {
            gallery.push({
              src: local.src,
              srcset: local.srcset,
              alt: String(node.properties.alt),
              width: local.width,
              height: local.height,
              shot: /screenshot|gui|window|menu|settings/i.test(src + ' ' + node.properties.alt),
            });
          }
        }
        // Links: keep anchors, map repo-relative paths to GitHub, allowlisted repos to site pages.
        if (node.tagName === 'a') {
          const href = String(node.properties.href ?? '');
          if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
          if (imageUrl[href]) {
            node.properties.href = imageUrl[href].src;
            return;
          }
          // A link to one of our repositories that isn't published here keeps its
          // words but loses the link (and the owner prefix), so it can't point to
          // an unlisted repo. The allowlist check still fails on excluded names.
          const anyRepo = href.match(new RegExp(`^https?://github\\.com/${GITHUB_OWNER}/([\\w.-]+)`, 'i'));
          if (anyRepo && !PUBLISHED.has(anyRepo[1].replace(/\.git$/, '').toLowerCase())) {
            console.warn(`  ! ${p.repo}: unlinked ${href} (not on the allowlist)`);
            const ownerPrefix = new RegExp(`${GITHUB_OWNER}/`, 'gi');
            visit(node, 'text', (t: any) => {
              t.value = t.value.replace(ownerPrefix, '');
            });
            if (parent && typeof index === 'number') {
              parent.children.splice(index, 1, ...node.children);
              return [SKIP, index];
            }
            return;
          }
          const repoLink = href.match(new RegExp(`^https?://github\\.com/${GITHUB_OWNER}/([\\w.-]+)/?$`, 'i'));
          if (repoLink) {
            const target = byRepo(repoLink[1]);
            if (target) node.properties.href = `/${target.kind === 'app' ? 'apps' : 'research'}/${target.slug}/`;
            return;
          }
          if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            node.properties.href = blobBase + href.replace(/^\.?\//, '');
          }
          node.properties.rel = ['noopener', 'noreferrer'];
        }
      });
    })
    .use(rehypeSlug)
    .use(() => (tree: any) => {
      visit(tree, 'element', (node: any, index, parent: any) => {
        if (/^h[2-3]$/.test(node.tagName) && node.properties.id) {
          toc.push({ depth: Number(node.tagName[1]), id: String(node.properties.id), text: hastToString(node).trim() });
        }
        // GitHub alerts: > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
        if (node.tagName === 'blockquote') {
          const first = node.children.find((c: any) => c.type === 'element');
          const lead = first?.children?.[0];
          const m = lead?.type === 'text' && lead.value.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
          if (m) {
            const kind = m[1].toLowerCase();
            lead.value = lead.value.slice(m[0].length);
            node.tagName = 'aside';
            node.properties = { className: ['callout', `callout-${kind}`], role: 'note' };
            node.children.unshift({
              type: 'element',
              tagName: 'p',
              properties: { className: ['callout-title'] },
              children: [{ type: 'text', value: kind[0].toUpperCase() + kind.slice(1) }],
            });
          }
        }
        // Task lists ("- [x] …"): GitHub renders disabled checkboxes with no label.
        // They can't be changed, so show a mark instead, with its state in words
        // for screen readers.
        if (node.tagName === 'input' && node.properties?.type === 'checkbox' && parent && typeof index === 'number') {
          const done = node.properties.checked !== undefined && node.properties.checked !== false;
          parent.children.splice(
            index,
            1,
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['task-mark', done ? 'task-done' : 'task-open'], ariaHidden: 'true' },
              children: [],
            },
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['sr-only'] },
              children: [{ type: 'text', value: done ? 'Done: ' : 'Not done: ' }],
            },
          );
          return [SKIP, index + 2];
        }
        // Wide tables scroll inside their own container.
        if (
          node.tagName === 'table' &&
          parent &&
          typeof index === 'number' &&
          parent.properties?.className?.[0] !== 'table-scroll'
        ) {
          parent.children[index] = {
            type: 'element',
            tagName: 'div',
            properties: { className: ['table-scroll'], tabIndex: 0 },
            children: [node],
          };
          return SKIP;
        }
      });
    })
    .use(() => (tree: any) => {
      const panels: [RegExp, string, string][] = [
        [/^raw evidence/i, 'panel-evidence', 'Raw evidence'],
        [
          /observation vs\.? (interpretation|inference)|capability vs\.? interpretation/i,
          'panel-interpret',
          'Observation vs. interpretation',
        ],
      ];
      const wrap = (parent: any) => {
        const kids = parent.children;
        for (let i = 0; i < kids.length; i++) {
          const h = kids[i];
          if (h.type !== 'element' || !/^h[2-5]$/.test(h.tagName)) continue;
          const text = hastToString(h).trim();
          const hit = panels.find(([re]) => re.test(text));
          if (!hit) continue;
          const level = Number(h.tagName[1]);
          let j = i + 1;
          while (
            j < kids.length &&
            !(kids[j].type === 'element' && /^h[1-6]$/.test(kids[j].tagName) && Number(kids[j].tagName[1]) <= level)
          )
            j++;
          const section = kids.slice(i, j);
          kids.splice(i, j - i, {
            type: 'element',
            tagName: 'section',
            properties: { className: ['panel', hit[1]], 'data-label': hit[2] },
            children: section,
          });
        }
      };
      wrap(tree);
    })
    .use(() => (tree: any) => {
      // Research write-ups: a paragraph holding just one image (optionally linked)
      // becomes a numbered <figure> with a caption from the image's title, or else
      // its alt text. When the caption repeats the alt, the image's alt is emptied
      // so screen readers don't hear it twice; the figcaption names the figure.
      if (p.kind !== 'research') return;
      let n = 0;
      const isBlank = (c: any) => c.type === 'text' && !c.value.trim();
      visit(tree, 'element', (node: any, index, parent: any) => {
        if (node.tagName !== 'p' || !parent || typeof index !== 'number') return;
        const kids = node.children.filter((c: any) => !isBlank(c));
        if (kids.length !== 1 || kids[0].type !== 'element') return;
        const only = kids[0];
        const img =
          only.tagName === 'img'
            ? only
            : only.tagName === 'a' && only.children.filter((c: any) => !isBlank(c)).length === 1
              ? only.children.find((c: any) => c.tagName === 'img')
              : null;
        if (!img) return;
        const alt = String(img.properties.alt ?? '').trim();
        const title = String(img.properties.title ?? '').trim();
        const caption = title || alt;
        if (!caption) return;
        if (!title) img.properties.alt = '';
        n++;
        parent.children[index] = {
          type: 'element',
          tagName: 'figure',
          properties: { className: ['figure'] },
          children: [
            only,
            {
              type: 'element',
              tagName: 'figcaption',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['figure-num'] },
                  children: [{ type: 'text', value: `Figure ${n}` }],
                },
                { type: 'text', value: ` ${caption}` },
              ],
            },
          ],
        };
        return SKIP;
      });
    })
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark-dimmed' },
      defaultColor: false,
      defaultLanguage: 'text',
      fallbackLanguage: 'text',
      addLanguageClass: true,
      transformers: [
        styleToClass,
        {
          pre(node: any) {
            const lang = (this as any).options.lang;
            node.properties['data-lang'] = lang === 'text' ? '' : lang;
          },
        },
      ],
    } as any)
    .use(() => (tree: any) => {
      // Frame every code block at build time: a bar with a label (terminal blocks
      // get window dots via CSS). The client script only adds the Copy button.
      visit(tree, 'element', (node: any, index, parent: any) => {
        if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return;
        if (parent.properties?.className?.includes?.('code-wrap')) return;
        const lang = String(node.properties?.['data-lang'] ?? '').toLowerCase();
        const kind = TERMINAL_LANGS.has(lang) ? 'terminal' : 'code';
        const label = LANG_LABELS[lang] ?? (lang || 'text');
        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['code-wrap'], 'data-kind': kind },
          children: [
            {
              type: 'element',
              tagName: 'div',
              properties: { className: ['code-bar'] },
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['code-lang'] },
                  children: [{ type: 'text', value: label }],
                },
              ],
            },
            node,
          ],
        };
        return SKIP;
      });
    })
    .use(() => (tree: any) => {
      // Section links: h2–h4 get a "#" link after the heading, in a wrapper so the
      // heading's own accessible name stays just its text. Same markup as
      // src/components/AnchorHeading.astro.
      visit(tree, 'element', (node: any, index, parent: any) => {
        if (!/^h[2-4]$/.test(node.tagName) || !node.properties.id || !parent || typeof index !== 'number') return;
        parent.children[index] = anchorHeading(node, hastToString(node).trim());
        return SKIP;
      });
    })
    .use(rehypeStringify)
    .process(md);

  // Drop empty paragraphs left behind by stripped badges and logos.
  const html = String(file).replace(/<p(?: align="center")?>\s*<\/p>\n?/g, '');
  const words = html
    .replace(/<a class="heading-anchor"[\s\S]*?<\/a>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

  const out = {
    ...meta,
    images: undefined,
    // Logos render at 48–96px: use the smallest variant, not the 2000px original.
    logo: (() => {
      const ref = p.logo ?? logoed.logo;
      if (!ref) return null;
      if (!imageUrl[ref]) throw new Error(`${p.slug}: logo "${ref}" was not downloaded; check the path in projects.ts`);
      return imageUrl[ref].srcset?.split(' ')[0] ?? imageUrl[ref].src;
    })(),
    logoShaped: await (async () => {
      const ref = p.logo ?? logoed.logo;
      const file = ref && meta.images[ref]?.file;
      return file ? isShapedLogo(join(dir, 'images', file)) : false;
    })(),
    scope: scoped.scope,
    html,
    toc,
    gallery: (gallery.some((g) => g.shot) ? gallery.filter((g) => g.shot) : gallery).slice(0, 8),
    readingMinutes: Math.max(1, Math.round(words / 230)),
  };
  await writeFile(join(OUT_JSON, `${p.slug}.json`), JSON.stringify(out));
  console.log(`  ✓ ${p.slug}: ${toc.length} headings, ${gallery.length} screenshots, ${diagrams.length} diagrams`);
}

// ─── Open Graph images ──────────────────────────────────────────────────────

const publisherLogo = (await readFile(join(ROOT, 'public/branding/hideouts/hideouts-horizontal-dark.svg'))).toString(
  'base64',
);

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Greedy word wrap by an approximate character budget. */
function wrapText(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,.;:]*\S*$/, '') + '…';
  }
  return lines;
}

async function renderOg(p: Project) {
  const font = '-apple-system, Helvetica, Arial, sans-serif';
  const title = wrapText(p.name, 26, 2);
  const tag = wrapText(p.tagline, 58, 2);
  const hosts = p.platforms.filter((x) => x !== 'macOS' && x !== 'iOS');
  const label =
    p.kind === 'app'
      ? `${p.platforms.filter((x) => x === 'macOS' || x === 'iOS').join(' · ')}${hosts.length ? ' · cross-platform' : ''} app`
      : 'Research';
  const titleY = 300;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="g" cx="80%" cy="0%" r="70%"><stop offset="0" stop-color="#2dd4bf" stop-opacity=".26"/><stop offset="1" stop-color="#0a0c0f" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M56 0H0V56" fill="none" stroke="#fff" stroke-opacity=".05"/></pattern>
  </defs>
  <rect width="1200" height="630" fill="#0a0c0f"/><rect width="1200" height="630" fill="url(#grid)"/><rect width="1200" height="630" fill="url(#g)"/>
  <image x="69" y="72" width="352" height="88" href="data:image/svg+xml;base64,${publisherLogo}"/>
  <text x="88" y="${titleY - 70}" font-family="Menlo, monospace" font-size="24" letter-spacing="2" fill="#5eead4">${xmlEscape(label.toUpperCase())}</text>
  ${title.map((l, i) => `<text x="88" y="${titleY + i * 78}" font-family="${font}" font-size="68" font-weight="600" letter-spacing="-2" fill="#e8ebef">${xmlEscape(l)}</text>`).join('')}
  ${tag.map((l, i) => `<text x="88" y="${titleY + (title.length - 1) * 78 + 72 + i * 44}" font-family="${font}" font-size="32" fill="#a9b2bd">${xmlEscape(l)}</text>`).join('')}
  <text x="88" y="570" font-family="Menlo, monospace" font-size="22" fill="#76808c">hideouts.io</text>
</svg>`;
  await mkdir(join(ROOT, 'public/og'), { recursive: true });
  await sharp(Buffer.from(svg))
    .png()
    .toFile(join(ROOT, 'public/og', `${p.slug}.png`));
}

await mkdir(OUT_JSON, { recursive: true });
for (const p of PROJECTS) {
  await renderProject(p);
  await renderOg(p);
}

// Shiki: every token color became a class; ship them as one stylesheet.
await writeFile(join(ROOT, 'src/styles/shiki.generated.css'), styleToClass.getCSS());
console.log('✓ Rendered content for', PROJECTS.length, 'projects');

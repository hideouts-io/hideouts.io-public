import { PROJECTS, CATEGORIES, type Category, type Project } from '../data/projects';

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  sha256: string | null;
}

export interface Generated {
  slug: string;
  repo: string;
  fetchedAt: string;
  htmlUrl: string;
  homepage: string | null;
  description: string | null;
  topics: string[];
  language: string | null;
  license: string | null;
  stars: number;
  forks: number;
  updatedAt: string;
  privateReporting: boolean;
  hasIssues: boolean;
  hasDiscussions: boolean;
  contributingUrl: string | null;
  /** True when contributingUrl is the account-wide guide from hideouts-io/.github. */
  contributingShared?: boolean;
  codeOfConductUrl: string | null;
  licenseUrl: string | null;
  archived: boolean;
  createdAt: string;
  /** Research: recent README revisions, newest first. */
  readmeHistory?: { sha: string; date: string; message: string; url: string }[];
  defaultBranch: string;
  release: {
    tag: string;
    name: string | null;
    url: string;
    publishedAt: string;
    prerelease: boolean;
    assets: ReleaseAsset[];
  } | null;
  logo: string | null;
  /** The logo has transparent corners (a circle, a badge, a macOS icon shape). */
  logoShaped: boolean;
  scope: string | null;
  html: string;
  toc: { depth: number; id: string; text: string }[];
  gallery: { src: string; srcset?: string; alt: string; width?: number; height?: number }[];
  readingMinutes: number;
}

export type Entry = Project & { gh: Generated; href: string };

export interface DisplayLogo {
  src: string | null;
  shaped: boolean;
}

const files = import.meta.glob<Generated>('../generated/*.json', { eager: true, import: 'default' });

function load(p: Project): Entry {
  const gh = files[`../generated/${p.slug}.json`];
  if (!gh) throw new Error(`Missing generated content for ${p.slug}. Run \`npm run content\` first.`);
  return { ...p, gh, href: `/${p.kind === 'app' ? 'apps' : 'research'}/${p.slug}/` };
}

export const entries = (): Entry[] => PROJECTS.map(load);

export function displayLogo(entry: Entry): DisplayLogo {
  return entry.siteLogo ?? { src: entry.gh.logo, shaped: entry.gh.logoShaped };
}
export const appEntries = () =>
  entries()
    .filter((e) => e.kind === 'app')
    .sort((a, b) => a.order - b.order);
export const researchEntries = () =>
  entries()
    .filter((e) => e.kind === 'research')
    .sort((a, b) => a.order - b.order);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

export const fmtBytes = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`;

/**
 * Release status, derived from GitHub data only (never hand-written):
 *   - no release        → "Source only" (build from source)
 *   - prerelease        → "Prerelease"
 *   - v0.x              → "Pre-1.0"
 *   - v1.0 and later    → "Released"
 * Archived repositories are always "Archived".
 */
export function releaseStatus(gh: Generated): { label: string; tone: 'neutral' | 'accent' | 'muted' } {
  if (gh.archived) return { label: 'Archived', tone: 'muted' };
  if (!gh.release) return { label: 'Source only', tone: 'neutral' };
  if (gh.release.prerelease) return { label: 'Prerelease', tone: 'neutral' };
  const major = Number(gh.release.tag.replace(/^v/i, '').split('.')[0]);
  return Number.isFinite(major) && major >= 1
    ? { label: 'Released', tone: 'accent' }
    : { label: 'Pre-1.0', tone: 'neutral' };
}

export const categoryLabel = (c: Category) => CATEGORIES[c].label;

/** Apps grouped by category, in category order, for discovery sections. */
export function appsByCategory() {
  const apps = appEntries();
  return (Object.keys(CATEGORIES) as Category[])
    .map((c) => ({ key: c, ...CATEGORIES[c], apps: apps.filter((a) => a.categories?.includes(c)) }))
    .filter((g) => g.apps.length > 0);
}

/** Related apps: most shared categories first, then shared platforms. */
export function relatedApps(e: Entry, limit = 3) {
  const score = (a: Entry) =>
    (a.categories ?? []).filter((c) => e.categories?.includes(c)).length * 10 +
    a.platforms.filter((p) => e.platforms.includes(p)).length;
  return appEntries()
    .filter((a) => a.slug !== e.slug)
    .sort((a, b) => score(b) - score(a) || a.order - b.order)
    .slice(0, limit);
}

/** Every published release across projects, newest first. */
export function recentReleases(limit = 5) {
  return entries()
    .filter((e) => e.gh.release)
    .sort((a, b) => +new Date(b.gh.release!.publishedAt) - +new Date(a.gh.release!.publishedAt))
    .slice(0, limit);
}

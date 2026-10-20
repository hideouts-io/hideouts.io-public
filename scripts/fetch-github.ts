/**
 * Step 1 of the content pipeline: download everything the site needs from
 * GitHub for the allowlisted repositories only, into .cache/github/.
 *
 *   node scripts/fetch-github.ts
 *
 * Uses GITHUB_TOKEN (or GH_TOKEN) when present. In CI a token is required so a
 * rate-limited anonymous build can never publish a half-empty site.
 *
 * Failure handling:
 *   - Each repo is downloaded into a temporary folder and swapped in only when
 *     complete, so a failed run never leaves a half-written cache.
 *   - If GitHub is unavailable for a repo that was fetched before, the last good
 *     copy is kept and the build continues (with a warning).
 *   - A repo that is missing or private is a hard failure: never publish it
 *     from a stale cache.
 */
import { mkdir, writeFile, rm, rename, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GITHUB_OWNER, PROJECTS } from '../src/data/projects.ts';
import { imageSources } from '../src/lib/image-sources.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, '.cache/github');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token && process.env.CI) {
  console.error('✗ GITHUB_TOKEN is required in CI. Refusing to build from anonymous API calls.');
  process.exit(1);
}

const headers: Record<string, string> = {
  'User-Agent': 'hideouts.io-site-builder',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

/** Errors that must stop the build even when a cached copy exists. */
class FatalError extends Error {}

async function api(path: string, accept = 'application/vnd.github+json') {
  const res = await fetch(`https://api.github.com${path}`, { headers: { ...headers, Accept: accept } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const hint = remaining === '0' ? ' (rate limit exhausted; set GITHUB_TOKEN)' : '';
    throw new Error(`GitHub API ${res.status} for ${path}${hint}`);
  }
  return accept.includes('raw') ? res.text() : res.json();
}

const IMAGE_RE = [
  /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, // ![alt](src "title")
  /<img[^>]+src=["']([^"']+)["']/gi, // <img src="">
];
const BADGE_RE = /(img\.shields\.io|badge\.svg|badgen\.net|\/workflows\/.+\/badge)/i;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Resolve a README image reference to a downloadable URL inside the repo (or external). */
function resolveImage(src: string, repo: string, branch: string): { url: string; repoPath?: string } | null {
  if (BADGE_RE.test(src) || src.startsWith('data:')) return null;
  const inRepo = new RegExp(
    `^https?://(?:raw\\.githubusercontent\\.com/${GITHUB_OWNER}/${repo}/[^/]+/|github\\.com/${GITHUB_OWNER}/${repo}/(?:blob|raw)/[^/]+/)(.+?)(\\?.*)?$`,
    'i',
  );
  const m = src.match(inRepo);
  if (m)
    return {
      url: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${repo}/${branch}/${m[1]}`,
      repoPath: decodeURI(m[1]),
    };
  if (/^https?:\/\//i.test(src)) return { url: src };
  const clean = src.replace(/^\.?\//, '').split(/[?#]/)[0];
  return {
    url: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${repo}/${branch}/${clean}`,
    repoPath: decodeURI(clean),
  };
}

async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { 'User-Agent': headers['User-Agent'] } });
  if (!res.ok) {
    console.warn(`  ! image ${res.status}: ${url}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    console.warn(`  ! image too large (${buf.length} bytes), skipped: ${url}`);
    return null;
  }
  return buf;
}

await mkdir(CACHE, { recursive: true });
const fetchedAt = new Date().toISOString();

/**
 * Shared community health files in hideouts-io/.github apply to every repo that
 * lacks its own copy. Look them up once; missing or unreachable means "none".
 */
async function sharedFile(path: string) {
  const found = await api(`/repos/${GITHUB_OWNER}/.github/contents/${path}`).catch(() => null);
  return found?.html_url ?? null;
}
const shared = {
  contributing: await sharedFile('CONTRIBUTING.md'),
  codeOfConduct: await sharedFile('CODE_OF_CONDUCT.md'),
};

/**
 * A repo's "homepage" setting can outlive the site it points to. Keep it only if
 * it currently answers; drop it on a definite 4xx/5xx. Network errors keep it,
 * so a flaky connection doesn't remove a working link.
 */
async function liveHomepage(url: string | null, repo: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': headers['User-Agent'] },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 400) {
      console.warn(`  ! ${repo} homepage ${url} returned ${res.status}; not linking it`);
      return null;
    }
  } catch {
    // Unreachable right now: keep the link rather than guess.
  }
  return url;
}

/** Contributing guide and code of conduct: the repo's own, else the shared default. */
function communityFiles(community: any) {
  const own: string | null = community?.files?.contributing?.html_url ?? null;
  const ownCoc: string | null =
    community?.files?.code_of_conduct_file?.html_url ?? community?.files?.code_of_conduct?.html_url ?? null;
  const isShared = (url: string | null) => Boolean(url?.includes(`/${GITHUB_OWNER}/.github/`));
  return {
    contributingUrl: own ?? shared.contributing,
    contributingShared: isShared(own) || (!own && Boolean(shared.contributing)),
    codeOfConductUrl: ownCoc ?? shared.codeOfConduct,
  };
}

/**
 * README commits as revision entries: the first line of each message, with a
 * merge commit's pull-request title in place of "Merge pull request #N from …".
 */
function revisions(commits: any[], limit = 5) {
  return commits
    .map((c) => {
      const lines = String(c.commit?.message ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^co-authored-by:/i.test(l));
      const merge = /^Merge (pull request|branch)\b/i.test(lines[0] ?? '');
      const message = merge ? lines[1] : lines[0];
      return message
        ? { sha: c.sha as string, date: c.commit.committer.date as string, message, url: c.html_url as string }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .slice(0, limit);
}

async function fetchProject(p: (typeof PROJECTS)[number]) {
  const repo = await api(`/repos/${GITHUB_OWNER}/${p.repo}`);
  if (!repo) throw new FatalError(`Allowlisted repo ${p.repo} was not found (renamed, deleted, or private?)`);
  if (repo.private) throw new FatalError(`Allowlisted repo ${p.repo} is private. Refusing to publish it.`);

  const branch: string = repo.default_branch;
  const readme: string = (await api(`/repos/${GITHUB_OWNER}/${p.repo}/readme`, 'application/vnd.github.raw')) ?? '';
  const releasePath = p.releaseTag ? `tags/${encodeURIComponent(p.releaseTag)}` : 'latest';
  const release = await api(`/repos/${GITHUB_OWNER}/${p.repo}/releases/${releasePath}`);
  if (p.releaseTag && (!release || release.draft || release.tag_name !== p.releaseTag))
    throw new FatalError(`${p.repo}: configured release ${p.releaseTag} is not published`);
  if (release && typeof release.prerelease !== 'boolean')
    throw new FatalError(`${p.repo}: release ${release.tag_name} has no valid prerelease status`);
  const commits = await api(`/repos/${GITHUB_OWNER}/${p.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`);
  const updatedAt: string = commits?.[0]?.commit?.committer?.date ?? repo.pushed_at;
  // Needs a token with repo access; treat "unknown" as not enabled.
  const pvr = token
    ? await api(`/repos/${GITHUB_OWNER}/${p.repo}/private-vulnerability-reporting`).catch(() => null)
    : null;
  // Contributing guide, code of conduct, and security policy, if the repo has them.
  const community = await api(`/repos/${GITHUB_OWNER}/${p.repo}/community/profile`).catch(() => null);
  // Research: the README's recent revisions, shown as a revision history.
  const history =
    p.kind === 'research'
      ? await api(
          `/repos/${GITHUB_OWNER}/${p.repo}/commits?sha=${encodeURIComponent(branch)}&path=README.md&per_page=10`,
        ).catch(() => null)
      : null;

  const finalDir = join(CACHE, p.slug);
  const dir = join(CACHE, `.${p.slug}.partial`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'images'), { recursive: true });

  // Download every non-badge image the README references.
  const images: Record<string, { file: string; repoPath?: string }> = {};
  const refs = new Set<string>();
  for (const re of IMAGE_RE) for (const m of readme.matchAll(re)) refs.add(m[1]);
  for (const m of readme.matchAll(/<(?:source|img)\b[^>]+srcset=["']([^"']+)["']/gi))
    for (const source of imageSources(m[1])) refs.add(source.src);
  // Linked full-size images, e.g. [![x](a.png)](a.png)
  for (const m of readme.matchAll(/\]\(\s*([^)\s]+\.(?:png|jpe?g|gif|webp|svg))\s*\)/gi)) refs.add(m[1]);
  // A logo named in projects.ts (repo-relative), for READMEs that don't show one.
  if (p.logo) refs.add(p.logo);

  let n = 0;
  for (const src of refs) {
    const target = resolveImage(src, p.repo, branch);
    if (!target) continue;
    const buf = await download(target.url);
    if (!buf) continue;
    const ext = (target.url.split(/[?#]/)[0].match(/\.(png|jpe?g|gif|webp|svg)$/i)?.[1] ?? 'png').toLowerCase();
    const file = `img-${String(++n).padStart(2, '0')}.${ext}`;
    await writeFile(join(dir, 'images', file), buf);
    images[src] = { file, repoPath: target.repoPath };
  }

  const meta = {
    slug: p.slug,
    repo: p.repo,
    fetchedAt,
    htmlUrl: repo.html_url,
    homepage: await liveHomepage(repo.homepage || null, p.repo),
    description: repo.description,
    topics: repo.topics ?? [],
    language: repo.language,
    license: repo.license && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    updatedAt,
    privateReporting: Boolean(pvr?.enabled),
    hasIssues: repo.has_issues,
    hasDiscussions: Boolean(repo.has_discussions),
    // The repo's own file, else the account-wide default from hideouts-io/.github.
    ...communityFiles(community),
    licenseUrl: community?.files?.license?.html_url ?? null,
    archived: Boolean(repo.archived),
    createdAt: repo.created_at,
    defaultBranch: branch,
    release: release
      ? {
          tag: release.tag_name,
          name: release.name,
          url: release.html_url,
          publishedAt: release.published_at,
          prerelease: release.prerelease,
          assets: (release.assets ?? []).map((a: any) => ({
            name: a.name,
            size: a.size,
            url: a.browser_download_url,
            sha256: typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7) : null,
          })),
        }
      : null,
    readmeHistory: Array.isArray(history) ? revisions(history) : [],
    images,
  };
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  await writeFile(join(dir, 'README.md'), readme);
  // Swap in the complete download.
  await rm(finalDir, { recursive: true, force: true });
  await rename(dir, finalDir);
  return `${Object.keys(images).length} images, release ${meta.release?.tag ?? 'none'}`;
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const stale: string[] = [];
for (const p of PROJECTS) {
  process.stdout.write(`→ ${p.repo}\n`);
  try {
    console.log(`  ✓ ${await fetchProject(p)}`);
  } catch (err) {
    await rm(join(CACHE, `.${p.slug}.partial`), { recursive: true, force: true });
    if (err instanceof FatalError) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
    if (await exists(join(CACHE, p.slug, 'meta.json'))) {
      console.warn(`  ! ${(err as Error).message}; keeping the last good copy`);
      stale.push(p.repo);
    } else {
      console.error(`✗ ${(err as Error).message}, and there is no cached copy to fall back on.`);
      process.exit(1);
    }
  }
}

console.log(
  stale.length
    ? `✓ Fetched ${PROJECTS.length - stale.length}/${PROJECTS.length} repositories; used cached data for: ${stale.join(', ')}`
    : `✓ Fetched ${PROJECTS.length} allowlisted repositories`,
);

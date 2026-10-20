/**
 * Fails the build if anything outside the allowlist made it into dist/.
 *
 *   node scripts/check-allowlist.ts
 *
 * Checks every built text file for:
 *   1. any `hideouts-io/<repo>` reference without a catalog or scoped allowance (fails),
 *   2. the bare name of a never-publish or private repository (fails), and
 *   3. the bare name of any other repository in the account that isn't
 *      allowlisted, fetched live when a token is available (warns: a README may
 *      mention a new repo by name before it's added here; the renderer already
 *      turns links to such repos into plain text).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_REPOS, FORMER_REPO_NAMES, INFRA_REPOS, GITHUB_OWNER } from '../src/data/projects.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

// Never publish these, even if they're renamed or the API is unavailable.
const NEVER = ['kali-ssh', 'OMG-Protocol-Watch', 'SplunkFound', 'DNS-domain_analyzer', 'macos-install-data'];

const allowed = new Set([...ALLOWED_REPOS, ...FORMER_REPO_NAMES, ...INFRA_REPOS].map((r) => r.toLowerCase()));
const forbidden = new Set(NEVER.map((n) => n.toLowerCase()));
const unlisted = new Set<string>();

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const requireLive = process.env.REQUIRE_LIVE_ALLOWLIST === '1';
if (!token && requireLive) throw new Error('Live repository allowlist check requires a read-scoped GitHub token');
if (token) {
  try {
    const res = await fetch(`https://api.github.com/users/${GITHUB_OWNER}/repos?per_page=100&type=all`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'hideouts.io-site-builder' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub repository listing returned HTTP ${res.status}`);
    const repositories: unknown = await res.json();
    if (
      !Array.isArray(repositories) ||
      repositories.some(
        (repo: unknown) =>
          repo === null ||
          typeof repo !== 'object' ||
          !('name' in repo) ||
          typeof repo.name !== 'string' ||
          !('private' in repo) ||
          typeof repo.private !== 'boolean',
      )
    )
      throw new TypeError('GitHub repository listing had an invalid response');
    if (res.headers.get('link')?.includes('rel="next"'))
      throw new Error('GitHub repository listing was truncated; pagination is required');
    for (const repo of repositories as { name: string; private: boolean }[]) {
      const name = repo.name.toLowerCase();
      if (allowed.has(name)) continue;
      // The account listing is supplemental; a current private policy is still required.
      if (repo.private || NEVER.some((n) => name.startsWith(n.toLowerCase()))) forbidden.add(name);
      else unlisted.add(name);
    }
  } catch (error) {
    if (requireLive) throw new Error('Live repository allowlist check unavailable', { cause: error });
    console.warn('! Live repository listing unavailable; static allowlist checks continue.');
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else if (
      ['.html', '.xml', '.json', '.txt', '.js', '.css', '.svg', '.md', '.map', '.webmanifest'].includes(extname(d.name))
    )
      yield p;
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ownerRef = new RegExp(`${GITHUB_OWNER}/([A-Za-z0-9_.-]+)`, 'gi');
const bareRe = (n: string) => [n, new RegExp(`(?<![\\w-])${escapeRe(n)}(?![\\w-])`, 'i')] as const;
const bareRes = [...forbidden].map(bareRe);
const unlistedRes = [...unlisted].map(bareRe);

const problems: string[] = [];
const warnings: string[] = [];
for await (const file of walk(DIST)) {
  const text = await readFile(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const m of text.matchAll(ownerRef)) {
    const name = m[1].replace(/\.git$/, '');
    if (!allowed.has(name.toLowerCase()) && name.toLowerCase() !== GITHUB_OWNER.toLowerCase()) {
      problems.push(`${rel}: references non-allowlisted repo "${GITHUB_OWNER}/${name}"`);
    }
  }
  for (const [name, re] of bareRes) if (re.test(text)) problems.push(`${rel}: mentions excluded repo "${name}"`);
  for (const [name, re] of unlistedRes) if (re.test(text)) warnings.push(`${rel}: mentions unlisted repo "${name}"`);
}

if (warnings.length) {
  console.warn(`! Unlisted repository mentions require review (${new Set(warnings).size}).`);
}

if (problems.length) {
  console.error(`✗ Allowlist check failed (${new Set(problems).size} findings).`);
  process.exit(1);
}
console.log(
  `✓ Allowlist check passed: ${ALLOWED_REPOS.size} catalog repositories, ${FORMER_REPO_NAMES.size} former names, ${INFRA_REPOS.size} infrastructure repositories`,
);

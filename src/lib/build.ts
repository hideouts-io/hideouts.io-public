/**
 * Where this build came from: the site commit, the time, and (in CI) the
 * GitHub Actions run. Shown in the footer and on /colophon/ so anyone can trace
 * the live site back to its source.
 */
import { execFileSync } from 'node:child_process';

const SITE_REPO = 'https://github.com/hideouts-io/hideouts.io-public';
const env = process.env;

function localCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// On pull requests GITHUB_SHA is a temporary merge commit; the workflow passes
// the PR head instead (SITE_COMMIT) so the link always resolves.
const sha = env.SITE_COMMIT || env.GITHUB_SHA || localCommit();
const runId = env.GITHUB_RUN_ID;

const TRIGGERS: Record<string, string> = {
  push: 'a push to main',
  pull_request: 'a pull request',
  schedule: 'nightly validation',
  repository_dispatch: 'a project update validation',
  workflow_dispatch: 'a manual run',
};

export const build = {
  sha,
  short: sha.slice(0, 7),
  commitUrl: sha ? `${SITE_REPO}/commit/${sha}` : null,
  runUrl: runId ? `${SITE_REPO}/actions/runs/${runId}` : null,
  trigger: env.GITHUB_EVENT_NAME ? (TRIGGERS[env.GITHUB_EVENT_NAME] ?? env.GITHUB_EVENT_NAME) : 'a local build',
  time: new Date().toISOString(),
  repoUrl: SITE_REPO,
  workflowUrl: `${SITE_REPO}/blob/main/.github/workflows/deploy.yml`,
};

# Contributing to hideouts.io

This repository is the website only. To contribute to an app or a research project, use that project's repository; [hideouts.io/contribute](https://hideouts.io/contribute/) lists where to go for each one.

## Before you start

- Node 24 or later (`nvm use` reads `.nvmrc`).
- Optional: a GitHub token (`export GITHUB_TOKEN=$(gh auth token)`) so content fetches aren't rate-limited.

```sh
npm ci
npm run content
npm test
npm run preview
```

## Making changes

- **Project copy** (names, taglines, highlights, categories, traits) lives in [`src/data/projects.ts`](src/data/projects.ts). Keep every claim traceable to the project's README. Don't describe capabilities a tool doesn't have.
- **Project details** (README, releases, license, stars) come from GitHub. Fix them in the project's repository, not here.
- **Adding a repository** to the site is a deliberate decision: see "The allowlist" in the [README](README.md).
- **No inline scripts, inline event handlers, or inline `style` attributes.** The Content Security Policy blocks them. Use `src/scripts/site.ts` and CSS classes.
- **No third-party requests**: no external fonts, images, scripts, analytics, or embeds.
- **Minimal JavaScript.** Pages must work without it; scripts only enhance.
- **Accessibility**: semantic HTML first, visible focus, labels on every control, and contrast of at least 4.5:1 in both themes.

## Before opening a pull request

```sh
npm test
```

This runs lint, format check, type check, the production build, the allowlist check, and the internal link check. CI runs the same steps plus an external link check.

## Security

Report vulnerabilities in the site privately, as described at [hideouts.io/security](https://hideouts.io/security/). Don't open a public issue.

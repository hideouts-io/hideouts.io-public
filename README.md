# hideouts.io

Source for [hideouts.io](https://hideouts.io), the home of the open-source macOS and iOS privacy and security apps and research published at [github.com/hideouts-io](https://github.com/hideouts-io).

It's a static [Astro](https://astro.build) site. Project pages use reviewed snapshots of each repository's README. A README change reaches the site through a separate reviewed content update.

- **Only allowlisted software repositories are published.**
- **Dark by default.** The site ignores the device's light/dark setting and always opens dark; the header toggle switches to light and remembers that choice in the browser only.
- **No tracking and no third-party requests.** No analytics, no cookies, no external fonts or images. README images are included in the reviewed site snapshot.
- **Strict Content Security Policy.** Scripts and styles are allowed by hash only, with no `unsafe-inline`.

## Local development

Requires Node 24 or later (see [`.nvmrc`](.nvmrc); `nvm use` picks it up).

```sh
npm ci
npm run build                          # verify the pinned snapshot, then build dist/ and search
npm run verify                         # allowlist + internal link checks
npm run preview                        # serve dist/ at http://localhost:4321
```

Run everything CI runs (except the external link check) with:

```sh
npm test    # lint, format check, type check, build, allowlist + link checks
```

`npm run dev` also works for editing layouts, but the production build is the only way to test search and the Content Security Policy.

| Script                            | What it does                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run content:fetch`           | Downloads README, metadata, latest release, contribution files, and README images for each allowlisted repo into `.cache/github/`.                                                                                      |
| `npm run content:render`          | Renders READMEs to HTML (GitHub alerts, diagrams, syntax highlighting), makes responsive WebP images (640/1200/2000px), and generates share images. Output goes to `src/generated/`, `public/media/`, and `public/og/`. |
| `npm run build`                   | `astro build`, verify and apply the reviewed site snapshot, then build the Pagefind search index.                                                                                                                       |
| `npm run verify`                  | `check:allowlist` + `check:links`.                                                                                                                                                                                      |
| `npm run check:allowlist`         | Fails if anything outside the allowlist appears in `dist/`.                                                                                                                                                             |
| `npm run check:links`             | Fails if any internal link, image, or `#anchor` in `dist/` doesn't resolve.                                                                                                                                             |
| `npm run lint`                    | ESLint for TypeScript and Astro, including accessibility rules (`eslint-plugin-jsx-a11y-x`).                                                                                                                            |
| `npm run format` / `format:check` | Prettier (with the Astro plugin).                                                                                                                                                                                       |
| `npm run typecheck`               | `astro check`: TypeScript and Astro diagnostics.                                                                                                                                                                        |
| `npm test`                        | All of the above except fetching content.                                                                                                                                                                               |

The reviewed snapshot (`src/generated/`, `public/media/`, `public/og/`, `src/styles/shiki.generated.css`, and `site-snapshot/`) is committed with the site. The build checks every pinned file against `site-snapshot/manifest.txt`. `.cache/` is local only and is not used by ordinary or production builds.

### Refreshing project content

`npm run content` fetches and renders the allowlisted repositories for review. It is a separate update operation, not a build step. Review its text, images, links, and generated outputs, then update and review the snapshot manifest and page fragments before merging. A changed or missing pinned file makes the normal build fail.

The fetch step never leaves a half-written local cache: each repository downloads into a temporary folder and replaces the old copy only when it's complete. If the API fails for a repository that has a cached copy, the fetch can keep that copy and print a warning. It fails when there is nothing to fall back on, or when an allowlisted repository has been deleted or made private: stale copies of those are never published.

A repository's **homepage** setting is linked ("Project site") only if it currently responds; a 4xx/5xx drops the link with a warning, so the site never points at a dead page.

## The allowlist

[`src/data/projects.ts`](src/data/projects.ts) is the only place repositories are defined. Anything not listed there is never fetched or rendered, including repositories created later. `check:allowlist` enforces this on every build. It fails on:

- any `hideouts-io/<repo>` reference to a repo that isn't listed, and
- the name of any private repository in the account, or of anything on the fixed never-publish list in [`scripts/check-allowlist.ts`](scripts/check-allowlist.ts).

It only warns when a README mentions another public repository that isn't listed yet. The renderer turns links to such repositories into plain text, so a README can mention a new project without stopping the deploy.

### Add a repository

1. Make sure the repository is public and its README is ready to publish.
2. Add an entry to `PROJECTS` in `src/data/projects.ts`:

   ```ts
   {
     slug: 'new-tool',             // URL: /apps/new-tool/ or /research/new-tool/
     repo: 'New-Tool',             // exact GitHub repository name
     kind: 'app',                  // 'app' or 'research'
     platforms: ['macOS'],         // 'macOS', 'iOS', 'Windows', 'Linux', 'ChromeOS'
     categories: ['security'],     // apps only; keys of CATEGORIES in projects.ts
     name: 'New Tool',
     tagline: 'One sentence that says why it matters.',
     summary: 'Two sentences for cards, search results, and share previews.',
     highlights: ['Four short', 'feature bullets', 'shown on the', 'app page'],
     traits: ['Read-only'],        // only claims the README actually states
     requires: ['macOS 13 or later'], // as the README states; shown next to the download
     signing: 'Ad-hoc signed · not notarized', // as the README states
     attested: false,              // true if releases carry GitHub build attestations
     editions: [{ slug: 'new-tool-swift', note: 'One line on how it differs.' }], // optional: other editions
     order: 9,
   },
   ```

3. Refresh and review the content snapshot, its manifest, and the page; then run `npm run build && npm run verify`.

The fields you write by hand (name, tagline, summary, highlights, traits, categories) are the curated layer. Everything else comes from GitHub: description, license, stars, latest release and checksums, last commit date, README, screenshots, logo, and whether the repo has Issues, Discussions, a contributing guide, and private vulnerability reporting.

**Status is never hand-written.** It's derived from releases: no release → "Source only", `v0.x` → "Pre-1.0", `v1.0`+ → "Released", archived repo → "Archived". Maturity notes that a README states explicitly (for example "Early-stage") go in `traits`.

**Categories** (`CATEGORIES` in `projects.ts`) drive the filters on `/apps/`, the category links on the home page, and "Related apps". Only add a category that at least one repository actually fits.

### Hide part of a README: `stripSections`

To leave a README section off the site without changing the README, list its heading text:

```ts
stripSections: ['Repository'],
```

This removes the heading and everything under it, up to the next heading of the same or higher level. The build warns if the heading isn't found.

### How READMEs are adapted

- The title, badge rows, and the README's own table of contents are removed; the site shows its own.
- A `> **Scope:** …` blockquote becomes the page's "Scope & boundaries" panel.
- A logo near the top becomes the app icon. Logos with transparent corners (a circle or badge) are shown as they are; square ones get a rounded tile.
- GitHub alerts (`> [!NOTE]`, `[!WARNING]`, …) become styled callouts.
- Sections titled "Raw evidence…" and "Direct observation vs. interpretation" become labeled panels.
- Mermaid diagrams become static light and dark SVGs, so no diagram JavaScript runs in the browser.
- Relative links point to GitHub. Links to other allowlisted repos point to their pages on this site.
- HTML is sanitized, and images from anywhere else are dropped.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds, checks, and deploys to GitHub Pages.

| Trigger                                  | Deploys?         | External link check |
| ---------------------------------------- | ---------------- | ------------------- |
| Push to `main`                           | No               | Blocking            |
| Pull request                             | No (checks only) | Blocking            |
| Nightly (06:17 UTC)                      | No               | Advisory            |
| `repository_dispatch` (`content-update`) | No               | Advisory            |
| Manual (`workflow_dispatch`)             | Yes              | Blocking            |

The nightly run validates the reviewed snapshot without publishing. A content-update dispatch also validates only; it does not fetch new README content:

```sh
gh api repos/hideouts-io/hideouts.io-public/dispatches -f event_type=content-update
```

To publish, manually run **Build and deploy** from `main`. The protected `site-policy-review` job requires independent approval and checks the exact packaged site against the current private release policy. A separate human approval in `github-pages` is required before deployment; the owner may approve that final job under the configured environment rules. Use the artifact and source identities from the same run when requesting production approval.

### One-time GitHub setup

1. Configure the protected `site-policy-review` and `github-pages` environments for the workflow's named reviewers, `main` branch restriction, and no administrator bypass. Set the stable inspector image and recipient certificate repository variables before a manual run. Finalize the private policy and its matching SHA-256 as environment secrets after reviewing that run's encrypted candidate and before approving `site-policy-review`; the deployment environment receives the same approved policy and digest for its independent freshness check.
2. **Settings → Pages → Build and deployment → Source:** GitHub Actions.
3. **Settings → Pages → Custom domain:** `hideouts.io`, then tick **Enforce HTTPS** once the certificate is issued.
4. **Organization/account settings → Pages → Verified domains:** add `hideouts.io` and create the TXT record GitHub shows you. This stops anyone else from claiming the domain on GitHub Pages.

## DNS for hideouts.io

At your DNS provider:

| Type  | Name                                  | Value                                     |
| ----- | ------------------------------------- | ----------------------------------------- |
| A     | `@`                                   | `185.199.108.153`                         |
| A     | `@`                                   | `185.199.109.153`                         |
| A     | `@`                                   | `185.199.110.153`                         |
| A     | `@`                                   | `185.199.111.153`                         |
| AAAA  | `@`                                   | `2606:50c0:8000::153`                     |
| AAAA  | `@`                                   | `2606:50c0:8001::153`                     |
| AAAA  | `@`                                   | `2606:50c0:8002::153`                     |
| AAAA  | `@`                                   | `2606:50c0:8003::153`                     |
| CNAME | `www`                                 | `hideouts-io.github.io`                   |
| TXT   | `_github-pages-challenge-hideouts-io` | _(value shown when verifying the domain)_ |

Remove any other A, AAAA, or CNAME records for `@` and `www`. DNS can take up to 24 hours to propagate. Check it with:

```sh
dig hideouts.io +noall +answer -t A
dig www.hideouts.io +noall +answer -t CNAME
```

Once the records resolve, GitHub issues the HTTPS certificate automatically. Enable **Enforce HTTPS** after that.

## Research pages

Each write-up gets a Key findings box (curated in `projects.ts`), a revision history from the README's recent commits, and a "Cite this write-up" panel with APA and BibTeX. GitHub topics shared by more than one project get a page under `/topics/` (language and framework tags, and topics shared only by editions of one tool, are skipped; see `src/lib/topics.ts`).

## Trust pages

- **[/verify/](https://hideouts.io/verify/)** explains checksums, GitHub build attestations, `codesign`, and opening non-notarized apps. Its release table and attestation example come from GitHub data plus `signing`/`attested` in `projects.ts`.
- App pages show release version, requirements, signing status, and an expandable SHA-256 panel next to the download button.

## Security model

- **Content Security Policy.** Astro emits a `<meta>` CSP with SHA-256 hashes for every script and style. Only `'self'` is allowed for everything else, `frame-src` and `object-src` are `'none'`, and the one extra source is `'wasm-unsafe-eval'`, which the Pagefind search index needs to run WebAssembly (it doesn't allow JavaScript `eval`).
- **Inline handlers and inline `style` attributes are blocked by the CSP,** so don't add them. Put behavior in `src/scripts/site.ts` and styling in classes.
- **Framing guard.** GitHub Pages can't send `X-Frame-Options` or a CSP `frame-ancestors` header, so a script in `<head>` ([`Base.astro`](src/layouts/Base.astro)) detects when another site loads a page in a frame, hides the content, shows an "Open hideouts.io" link, and tries to break out to the top window. A frame that disables scripts entirely can get around it; the site has no forms, logins, or actions, so there's nothing to trick a visitor into clicking. For header-level protection, put the site behind Cloudflare (see below).
- **Response headers.** GitHub Pages controls its own headers. [`public/_headers`](public/_headers) holds the full set (HSTS, `frame-ancestors`, `Permissions-Policy`, and more) and applies automatically if the site is hosted on Cloudflare Pages. If you keep GitHub Pages but proxy the domain through Cloudflare, add the same headers with a Cloudflare Transform Rule.
- **Vulnerability reports:** see [/security/](https://hideouts.io/security/) and [`/.well-known/security.txt`](public/.well-known/security.txt). Update the `Expires` date in `security.txt` before it lapses (currently 2027-09-24).

## Project layout

```text
scripts/
  fetch-github.ts      GitHub API → .cache/github/
  render-content.ts    README → HTML, images, diagrams, share images
  check-allowlist.ts   build fails on non-allowlisted repos
  check-links.ts       build fails on broken internal links
.github/
  workflows/deploy.yml checks, build, and GitHub Pages deploy
  dependabot.yml       weekly npm and Actions updates
src/
  data/projects.ts     the allowlist and curated copy
  lib/content.ts       typed loader for generated content
  layouts/Base.astro   <head>, SEO, theme, header/footer
  components/          cards, icons, README body with table of contents
  lib/seo.ts           canonical URLs and schema.org helpers
  pages/               home, apps, research, topics, verify, colophon, contribute, about, security, privacy, RSS, 404
  scripts/site.ts      theme toggle, copy buttons, table of contents, filters, lightbox, search
  styles/global.css    design tokens (dark and light), README styles
public/                favicon, CNAME, robots.txt, security.txt, _headers, og.png
```

## License

The site's source code is released under the [MIT License](LICENSE). Project content belongs to each project and is published under that project's own license. Apple, macOS, and iOS are trademarks of Apple Inc.; hideouts is not affiliated with Apple.

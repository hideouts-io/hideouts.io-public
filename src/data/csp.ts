/**
 * The Content Security Policy. astro.config.mjs feeds this to Astro, which adds
 * a SHA-256 hash for every script and style it emits; /colophon/ prints it.
 * No 'unsafe-inline', no third-party origins.
 */

/** Script sources besides the per-page hashes. */
export const CSP_SCRIPT_RESOURCES = [
  "'self'",
  // Pagefind's search index runs as WebAssembly; that needs 'wasm-unsafe-eval' (it does not allow JS eval).
  "'wasm-unsafe-eval'",
] as const;

export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "worker-src 'self'",
  // No 'upgrade-insecure-requests': every asset URL is same-origin and relative,
  // and GitHub Pages' "Enforce HTTPS" redirects HTTP at the server. The directive
  // broke the whole site (CSS/JS blocked) while the HTTPS certificate was pending.
] as const; // literal types, so Astro's config type accepts them

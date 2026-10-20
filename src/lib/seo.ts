/** Helpers for canonical URLs and schema.org structured data. */

export const SITE_URL = 'https://hideouts.io';

export const siteUrl = (path: string) => new URL(path, SITE_URL).toString();

/** The publisher behind hideouts.io. Referenced by @id from other schemas. */
export const organization = {
  '@type': 'Organization',
  '@id': siteUrl('/#organization'),
  name: 'hideouts.io',
  url: siteUrl('/'),
  logo: siteUrl('/icons/icon-512.png'),
  description: 'Open-source macOS and iOS privacy and security tools and evidence-first research.',
  sameAs: ['https://github.com/hideouts-io'],
};

export const website = {
  '@type': 'WebSite',
  '@id': siteUrl('/#website'),
  name: 'hideouts.io',
  url: siteUrl('/'),
  inLanguage: 'en',
  publisher: { '@id': siteUrl('/#organization') },
};

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...items].map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: siteUrl(it.path),
    })),
  };
}

/** A page on this site, linked to the site and its publisher. */
export function webPage(opts: {
  type?: 'WebPage' | 'AboutPage' | 'CollectionPage' | 'ContactPage';
  name: string;
  path: string;
  description: string;
  extra?: Record<string, unknown>;
}) {
  return {
    '@type': opts.type ?? 'WebPage',
    '@id': siteUrl(`${opts.path}#webpage`),
    name: opts.name,
    url: siteUrl(opts.path),
    description: opts.description,
    inLanguage: 'en',
    isPartOf: { '@id': siteUrl('/#website') },
    publisher: { '@id': siteUrl('/#organization') },
    ...opts.extra,
  };
}

/** Full graph for a simple page: organization, website, the page, and its breadcrumb. */
export function pageGraph(page: ReturnType<typeof webPage>, crumbs: { name: string; path: string }[]) {
  return { '@context': 'https://schema.org', '@graph': [organization, website, page, breadcrumbs(crumbs)] };
}

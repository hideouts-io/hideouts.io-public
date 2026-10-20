import type { APIRoute } from 'astro';
import { researchEntries } from '../../lib/content';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = ({ site }) => {
  const base = site!.toString().replace(/\/$/, '');
  const items = researchEntries()
    .sort((a, b) => +new Date(b.gh.updatedAt) - +new Date(a.gh.updatedAt))
    .map(
      (e) => `    <item>
      <title>${esc(e.name)}</title>
      <link>${base}${e.href}</link>
      <guid isPermaLink="true">${base}${e.href}</guid>
      <pubDate>${new Date(e.gh.updatedAt).toUTCString()}</pubDate>
      <description>${esc(`${e.tagline} ${e.summary}`)}</description>
    </item>`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>hideouts · Research</title>
    <link>${base}/research/</link>
    <atom:link href="${base}/research/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Evidence-first research on macOS and iOS privacy and security.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};

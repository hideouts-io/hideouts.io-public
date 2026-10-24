export function searchResultKind(url: string): 'App' | 'Research' | 'Page' {
  const path = new URL(url, 'https://hideouts.io').pathname;
  if (/^\/apps\/[^/]+\/$/.test(path)) return 'App';
  if (/^\/research\/[^/]+\/$/.test(path)) return 'Research';
  return 'Page';
}

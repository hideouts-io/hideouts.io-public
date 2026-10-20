// Progressive enhancements only. Every page works without JavaScript.

const root = document.documentElement;
// Dark unless the visitor has switched to light with the toggle.
const current = () => (root.dataset.theme === 'light' ? 'light' : 'dark');

document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((btn) => {
  const label = () => btn.setAttribute('aria-label', `Switch to ${current() === 'dark' ? 'light' : 'dark'} theme`);
  label();
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    if (next === 'light') root.dataset.theme = 'light';
    else delete root.dataset.theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', next === 'light' ? '#f7f8fa' : '#0a0c0f');
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', next);
    try {
      if (next === 'light') localStorage.setItem('theme', 'light');
      else localStorage.removeItem('theme');
    } catch {
      // Storage unavailable: the choice applies to this page view only.
    }
    label();
  });
});

// Code blocks: README blocks arrive framed from the build (bar + label); other
// <pre> blocks get a bar here. Either way, add a Copy button when the clipboard
// API is available.
document.querySelectorAll<HTMLPreElement>('.prose-readme pre').forEach((pre) => {
  let wrap = pre.parentElement?.classList.contains('code-wrap') ? pre.parentElement : null;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'code-wrap';
    pre.replaceWith(wrap);
    wrap.append(pre);
    const bar = document.createElement('div');
    bar.className = 'code-bar';
    wrap.prepend(bar);
  }
  const bar = wrap.querySelector<HTMLElement>('.code-bar')!;
  if (!navigator.clipboard) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'copy-btn';
  b.textContent = 'Copy';
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.innerText.replace(/\n$/, ''));
      b.textContent = 'Copied';
      b.dataset.copied = '';
    } catch {
      b.textContent = 'Press ⌘C';
    }
    setTimeout(() => {
      b.textContent = 'Copy';
      delete b.dataset.copied;
    }, 1600);
  });
  bar.append(b);
});

// Section links: follow the link as usual, and also copy the full URL.
const anchorStatus = document.createElement('p');
anchorStatus.className = 'sr-only';
anchorStatus.setAttribute('aria-live', 'polite');
document.body.append(anchorStatus);
document.querySelectorAll<HTMLAnchorElement>('.heading-anchor').forEach((a) => {
  a.addEventListener('click', async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(a.href);
    } catch {
      return;
    }
    a.dataset.copied = '';
    anchorStatus.textContent = 'Link to this section copied';
    setTimeout(() => {
      delete a.dataset.copied;
      anchorStatus.textContent = '';
    }, 1600);
  });
});

// Table of contents: highlight the section in view.
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]')];
if (tocLinks.length) {
  const pairs = tocLinks
    .map((a) => [document.getElementById(decodeURIComponent(a.hash.slice(1))), a] as const)
    .filter(([h]) => h) as (readonly [HTMLElement, HTMLAnchorElement])[];
  let active: HTMLAnchorElement | undefined;
  let queued = false;
  const update = () => {
    queued = false;
    let current: HTMLAnchorElement | undefined;
    for (const [h, a] of pairs) {
      if (h.getBoundingClientRect().top < 140) current = a;
      else break;
    }
    if (current === active) return;
    active?.removeAttribute('aria-current');
    current?.setAttribute('aria-current', 'true');
    active = current;
    // Keep the active entry visible inside the TOC's own scroll box only.
    const box = current?.closest<HTMLElement>('[data-toc-scroll]');
    if (current && box) {
      const top = current.offsetTop - box.offsetTop;
      if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40)
        box.scrollTop = top - box.clientHeight / 3;
    }
  };
  addEventListener(
    'scroll',
    () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}

// App filters (platform and category). Progressive enhancement: the controls
// are hidden in the HTML and only revealed here, so no-JS visitors see every app.
document.querySelectorAll<HTMLElement>('[data-filter-group]').forEach((group) => {
  const grid = document.getElementById(group.dataset.filterGroup!);
  if (!grid) return;
  const cards = [...grid.querySelectorAll<HTMLElement>('[data-platforms]')];
  const status = group.querySelector<HTMLElement>('[data-filter-status]');
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');
  const params = new URLSearchParams(location.search);
  const syncUrl = group.querySelector('[data-filter-category]') !== null;
  const state = {
    platform: params.get('platform') ?? 'all',
    category: params.get('category') ?? 'all',
  };

  const apply = () => {
    let shown = 0;
    for (const card of cards) {
      const platforms = card.dataset.platforms!.split(' ');
      const categories = (card.dataset.categories ?? '').split(' ');
      const okPlatform =
        state.platform === 'all' || (state.platform === 'iOS' ? platforms.includes('iOS') : !platforms.includes('iOS'));
      const okCategory = state.category === 'all' || categories.includes(state.category);
      const show = okPlatform && okCategory;
      (card.closest('li') ?? card).hidden = !show;
      if (show) shown++;
    }
    for (const kind of ['platform', 'category'] as const) {
      group.querySelectorAll<HTMLButtonElement>(`[data-filter-${kind}]`).forEach((b) => {
        b.setAttribute('aria-pressed', String(b.getAttribute(`data-filter-${kind}`) === state[kind]));
      });
    }
    if (status)
      status.textContent =
        shown === cards.length ? `Showing all ${shown} apps` : `Showing ${shown} of ${cards.length} apps`;
    if (empty) empty.hidden = shown > 0;
    if (syncUrl) {
      const q = new URLSearchParams();
      if (state.platform !== 'all') q.set('platform', state.platform);
      if (state.category !== 'all') q.set('category', state.category);
      history.replaceState(null, '', q.size ? `?${q}` : location.pathname);
    }
  };

  // Ignore unknown values from the URL rather than showing an empty grid.
  const valid = (kind: 'platform' | 'category') =>
    group.querySelector(`[data-filter-${kind}="${CSS.escape(state[kind])}"]`) !== null;
  if (!valid('platform')) state.platform = 'all';
  if (!valid('category')) state.category = 'all';

  for (const kind of ['platform', 'category'] as const) {
    group.querySelectorAll<HTMLButtonElement>(`[data-filter-${kind}]`).forEach((b) =>
      b.addEventListener('click', () => {
        state[kind] = b.getAttribute(`data-filter-${kind}`)!;
        apply();
      }),
    );
  }
  document.querySelector('[data-filter-reset]')?.addEventListener('click', () => {
    state.platform = 'all';
    state.category = 'all';
    apply();
  });
  apply();
});

// ── Screenshot lightbox ────────────────────────────────────────────────────
const lightboxLinks = document.querySelectorAll<HTMLAnchorElement>('a[data-lightbox]');
if (lightboxLinks.length && 'HTMLDialogElement' in window) {
  const dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.setAttribute('aria-label', 'Screenshot');
  dlg.innerHTML =
    '<div class="lb-bar"><p></p><button type="button" data-prev aria-label="Previous">←</button><button type="button" data-next aria-label="Next">→</button><button type="button" data-close>Close</button></div><img alt="">';
  document.body.append(dlg);
  const img = dlg.querySelector('img')!;
  const cap = dlg.querySelector('p')!;
  const list = [...lightboxLinks];
  let i = 0;
  const show = (n: number) => {
    i = (n + list.length) % list.length;
    img.src = list[i].href;
    img.alt = list[i].dataset.caption ?? '';
    cap.textContent = `${i + 1} / ${list.length}${img.alt ? ' · ' + img.alt : ''}`;
  };
  list.forEach((a, n) =>
    a.addEventListener('click', (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      ev.preventDefault();
      show(n);
      dlg.showModal();
      dlg.querySelector<HTMLButtonElement>('[data-close]')!.focus();
    }),
  );
  dlg.querySelector('[data-close]')!.addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-prev]')!.addEventListener('click', () => show(i - 1));
  dlg.querySelector('[data-next]')!.addEventListener('click', () => show(i + 1));
  dlg.addEventListener('click', (ev) => ev.target === dlg && dlg.close());
  dlg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') show(i - 1);
    if (ev.key === 'ArrowRight') show(i + 1);
  });
}

// ── Search (Pagefind, fully local) ─────────────────────────────────────────
const dialog = document.querySelector<HTMLDialogElement>('[data-search-dialog]');
if (dialog) {
  const input = dialog.querySelector<HTMLInputElement>('[data-search-input]')!;
  const results = dialog.querySelector<HTMLUListElement>('[data-search-results]')!;
  const status = dialog.querySelector<HTMLParagraphElement>('[data-search-status]')!;
  let pagefind: any;
  let seq = 0;
  let timer: number | undefined;
  let selected = -1;

  const load = async () => {
    if (pagefind) return pagefind;
    const path = '/pagefind/pagefind.js';
    try {
      pagefind = await import(/* @vite-ignore */ path);
      await pagefind.init?.();
    } catch {
      status.textContent = 'Search is available on the published site (run a production build to create the index).';
      pagefind = null;
    }
    return pagefind;
  };

  // Arrow keys move real focus between result links; Enter follows the focused link natively.
  const links = () => [...results.querySelectorAll<HTMLAnchorElement>('a')];
  const focusResult = (n: number) => {
    const items = links();
    if (!items.length) return;
    selected = (n + items.length) % items.length;
    items[selected].focus();
  };

  const run = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    if (!q) {
      results.replaceChildren();
      status.hidden = false;
      status.classList.remove('sr-only');
      status.textContent = 'Type to search every app and research write-up.';
      return;
    }
    const pf = await load();
    if (!pf || mine !== seq) return;
    const res = await pf.search(q);
    const data = await Promise.all(res.results.slice(0, 8).map((r: any) => r.data()));
    if (mine !== seq) return;
    results.replaceChildren();
    selected = -1;
    // Keep the live region in place so screen readers hear the count; hide it visually when results show.
    status.hidden = false;
    status.classList.toggle('sr-only', data.length > 0);
    status.textContent = data.length
      ? `${data.length} result${data.length === 1 ? '' : 's'} for “${q}”. Press the down arrow to move through them.`
      : `No results for “${q}”.`;
    for (const d of data) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = d.url;
      a.className = 'block rounded-lg px-3 py-2.5 hover:bg-surface-2 focus-visible:bg-surface-2';
      const top = document.createElement('div');
      top.className = 'flex items-center gap-2';
      const kind = document.createElement('span');
      kind.className = 'chip';
      kind.textContent = d.filters?.kind?.[0] ?? 'Page';
      const title = document.createElement('span');
      title.className = 'truncate font-medium text-ink';
      title.textContent = d.meta?.title ?? d.url;
      top.append(kind, title);
      const ex = document.createElement('p');
      ex.className = 'mt-1 line-clamp-2 text-sm leading-6 text-ink-2';
      // Pagefind excerpts are escaped text with <mark> highlights only.
      ex.innerHTML = d.excerpt;
      a.append(top, ex);
      li.append(a);
      results.append(li);
    }
  };

  const open = () => {
    if (!dialog.open) dialog.showModal();
    input.select();
    load();
  };
  document.querySelectorAll('[data-open-search]').forEach((b) => b.addEventListener('click', open));
  dialog.querySelector('[data-close-search]')!.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-search-form]')!.addEventListener('submit', (ev) => ev.preventDefault());
  dialog.addEventListener('click', (ev) => ev.target === dialog && dialog.close());
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 120);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      focusResult(0);
    } else if (ev.key === 'Enter') {
      links()[0]?.click();
    }
  });
  results.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const i = links().indexOf(document.activeElement as HTMLAnchorElement);
      if (ev.key === 'ArrowUp' && i <= 0) input.focus();
      else focusResult(i + (ev.key === 'ArrowDown' ? 1 : -1));
    }
  });
  addEventListener('keydown', (ev) => {
    const typing = (ev.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]');
    if ((ev.key === 'k' && (ev.metaKey || ev.ctrlKey)) || (ev.key === '/' && !typing)) {
      ev.preventDefault();
      open();
    }
  });
}

// Printing: show the contents of collapsed <details> (checksums, notes), then
// put them back the way they were.
let openedForPrint: HTMLDetailsElement[] = [];
addEventListener('beforeprint', () => {
  openedForPrint = [...document.querySelectorAll<HTMLDetailsElement>('main details:not([open])')].filter(
    (d) => !d.classList.contains('lg:hidden'),
  );
  openedForPrint.forEach((d) => (d.open = true));
});
addEventListener('afterprint', () => {
  openedForPrint.forEach((d) => (d.open = false));
  openedForPrint = [];
});

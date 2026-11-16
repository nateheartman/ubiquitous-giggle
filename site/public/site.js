// thoughtdesk.org: the download buttons, the tour's tabs, and the header's
// hairline once the page scrolls.

// The system this computer runs, as the Worker's /download tells them apart
// (src/index.ts: systemOf). An iPad says it's a Mac, but has a touch screen.
const ua = navigator.userAgent;
const system = /iPhone|iPad|Android|CrOS/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  ? null
  : /Macintosh|Mac OS X/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'windows';

// This system's button stands out, and the other two step back.
if (system) for (const el of document.querySelectorAll('[data-system]')) el.classList.toggle('secondary', el.dataset.system !== system);
// On Linux, the .deb is there for Ubuntu and Debian.
if (system === 'linux') for (const el of document.querySelectorAll('[data-deb]')) el.hidden = false;
// A phone or a tablet: there's no app for it.
if (!system) for (const el of document.querySelectorAll('[data-os-note]')) el.hidden = false;

// The latest version, from the Worker.
fetch('/api/release')
  .then((res) => (res.ok ? res.json() : null))
  .then((release) => {
    if (!release) return;
    for (const el of document.querySelectorAll('[data-version]')) el.textContent = `Version ${release.version} · free`;
  })
  .catch(() => {});

// The repository's stars on GitHub, from the Worker (it asks GitHub every 10
// minutes): beside the top bar's GitHub link, and under the download buttons.
fetch('/api/stars')
  .then((res) => (res.ok ? res.json() : null))
  .then((repo) => {
    if (typeof repo?.stars !== 'number') return;
    const count = repo.stars < 1000 ? String(repo.stars) : `${(repo.stars / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    for (const el of document.querySelectorAll('[data-star-count]')) el.textContent = count;
    for (const el of document.querySelectorAll('[data-stars], [data-stars-line]')) el.hidden = false;
  })
  .catch(() => {});

// Tabs, with arrow keys, Home and End as the ARIA pattern has them.
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', (e) => {
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length], true);
    });
  });
  select(tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0], false);
}

const nav = document.querySelector('.nav');
const onScroll = () => nav?.classList.toggle('scrolled', scrollY > 4);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

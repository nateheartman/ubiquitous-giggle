/**
 * thoughtdesk.org. The pages are the files in public/; this Worker runs in
 * front of them to send www.thoughtdesk.org to thoughtdesk.org, to answer
 * /download (the latest release's installer for the visitor's system),
 * /download/<system> (a given one's), /api/release (the version, date, and
 * each installer's address and size) and /api/stars (the repository's
 * GitHub stars), and to add security headers to every page.
 */

const REPO = 'kusule1351-hue/thought-desk';
const RELEASES = `https://github.com/${REPO}/releases/latest`;

interface Env {
  ASSETS: Fetcher;
}

/** One of the latest release's installers. */
interface Installer {
  url: string;
  size: number;
}

/** The systems there are installers for, and how each one's file is named. */
const SYSTEMS = {
  windows: '_x64-setup.exe',
  mac: '_universal.dmg',
  linux: '_amd64.AppImage',
  'linux-deb': '_amd64.deb',
} as const;
type System = keyof typeof SYSTEMS;

/** The latest release, with its installers by system. */
interface Release {
  version: string;
  date: string;
  installers: Partial<Record<System, Installer>>;
}

/** The system a browser runs on, from how it describes itself: a Mac or a
 *  Linux computer, else Windows. Phones and tablets get none (there's no
 *  app for them), nor does ChromeOS. */
function systemOf(userAgent: string): System | null {
  if (/iPhone|iPad|Android|CrOS/.test(userAgent)) return null;
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac';
  if (/Linux/.test(userAgent)) return 'linux';
  return 'windows';
}

/** The site is static and loads nothing from elsewhere. */
const HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
};

/** Asks GitHub at most every 10 minutes, well under its 60 an hour. */
async function latest(ctx: ExecutionContext): Promise<Release | null> {
  // v2: one installer per system (v1 held the Windows one alone).
  const key = new Request('https://thoughtdesk.org/api/release?v2');
  const cached = await caches.default.match(key);
  if (cached) return cached.json();
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'thoughtdesk.org' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    tag_name: string;
    published_at: string;
    assets: { name: string; browser_download_url: string; size: number }[];
  };
  const installers: Release['installers'] = {};
  for (const [system, suffix] of Object.entries(SYSTEMS) as [System, string][]) {
    const asset = data.assets.find((a) => a.name.endsWith(suffix));
    if (asset) installers[system] = { url: asset.browser_download_url, size: asset.size };
  }
  if (!Object.keys(installers).length) return null;
  const release: Release = { version: data.tag_name.replace(/^v/, ''), date: data.published_at, installers };
  ctx.waitUntil(caches.default.put(key, Response.json(release, { headers: { 'Cache-Control': 'max-age=600' } })));
  return release;
}

/** The repository's stars, asked of GitHub at most every 10 minutes too. */
async function stars(ctx: ExecutionContext): Promise<number | null> {
  const key = new Request('https://thoughtdesk.org/api/stars');
  const cached = await caches.default.match(key);
  if (cached) return ((await cached.json()) as { stars: number }).stars;
  const res = await fetch(`https://api.github.com/repos/${REPO}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'thoughtdesk.org' },
  });
  if (!res.ok) return null;
  const count = ((await res.json()) as { stargazers_count: number }).stargazers_count;
  ctx.waitUntil(caches.default.put(key, Response.json({ stars: count }, { headers: { 'Cache-Control': 'max-age=600' } })));
  return count;
}

function secure(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(HEADERS)) out.headers.set(name, value);
  // Cloudflare adds its analytics script to pages on the way out (free plans
  // have it on by default). no-transform stops that, at the cost of sending
  // pages uncompressed: the site promises no analytics.
  if (out.headers.get('Content-Type')?.startsWith('text/html')) {
    const cache = out.headers.get('Cache-Control');
    out.headers.set('Cache-Control', cache ? `${cache}, no-transform` : 'no-transform');
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    // The visitor's system's installer, or a given system's. Without one
    // (a phone, or GitHub not answering), the release page lists them all.
    const asked = url.pathname.match(/^\/download(?:\/([a-z-]+))?\/?$/);
    if (asked) {
      const system = asked[1] ? (Object.hasOwn(SYSTEMS, asked[1]) ? (asked[1] as System) : null) : systemOf(request.headers.get('User-Agent') ?? '');
      const release = system && (await latest(ctx).catch(() => null));
      return Response.redirect((release && release.installers[system!]?.url) || RELEASES, 302);
    }
    if (url.pathname === '/api/stars') {
      const count = await stars(ctx).catch(() => null);
      if (count === null) return Response.json({ error: 'GitHub is unavailable' }, { status: 503 });
      return Response.json({ stars: count }, { headers: { 'Cache-Control': 'public, max-age=600' } });
    }
    if (url.pathname === '/api/release') {
      const release = await latest(ctx).catch(() => null);
      if (!release) return Response.json({ error: 'GitHub is unavailable' }, { status: 503 });
      return Response.json(release, { headers: { 'Cache-Control': 'public, max-age=600' } });
    }
    return secure(await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<Env>;

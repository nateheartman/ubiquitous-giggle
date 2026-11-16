# thoughtdesk.org

The website: a landing page, the Privacy Policy and the Terms of Use, served by a small Cloudflare Worker.

- `public/`: the pages, styles, font and pictures, served as they are. There's no build step.
- `src/index.ts`: the Worker in front of them. It sends www.thoughtdesk.org to thoughtdesk.org, answers `/download` with the latest Windows installer on GitHub and `/api/release` with its version and size (the line under the download buttons), and adds security headers. The content security policy is strict: the site loads nothing from anywhere else. Pages also go out with `Cache-Control: no-transform`, which stops Cloudflare from adding its analytics script (on by default for free plans), so they're sent uncompressed.
- `scripts/screenshots.mjs`: retakes the app screenshots in `public/img/` (each view in light and dark, as WebP) and the link preview `public/og.png`. It drives the app's browser preview with a sample workspace, on a Wednesday morning so the week has classes in it.

The figures on the page (download size, memory, what was tested) come from the main README. Keep them in step when those change.

## Run it

```bash
cd site
npm install
npm run dev            # http://localhost:8790
npm run check          # type-checks the Worker
npm run screenshots    # retakes the screenshots; starts the app's preview if it isn't running
```

## Put it online

```bash
cd site
npx wrangler login     # once: approve in the browser
npm run deploy         # thoughtdesk.org and www.thoughtdesk.org
```

The domain is on the same Cloudflare account, so deploying adds its DNS records and certificate. If Cloudflare says a record already exists for thoughtdesk.org (a parking page, say), delete that record in the dashboard and deploy again.

## Before it goes live

- **support@thoughtdesk.org** is the contact address on every page. In the Cloudflare dashboard, open thoughtdesk.org → **Email** → **Email Routing**, turn it on, and forward `support@thoughtdesk.org` to your own inbox. It's free.
- **Privacy and Terms** are plain-language drafts written from what the app really does. Read them through: they aren't legal advice. They name Clerk, Supabase, Cloudflare, GitHub and Polar, so update them if any of that changes.
- **Selling with Polar:** once the product exists in Polar, add a pricing section with its checkout link. A plain link to Polar's checkout needs no change here; Polar's embedded checkout would need its script and frame allowed in the security policy in `src/index.ts`.

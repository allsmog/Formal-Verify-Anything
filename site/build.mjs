// Builds the GitHub Pages site in docs/ from the page sources in site/pages/.
// Each page source starts with a JSON header in an HTML comment:
//   <!--{"title": "...", "description": "...", "path": "/guides/"}-->
// Usage: node site/build.mjs
import { mkdir, readdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://allsmog.github.io/Formal-Verify-Anything';
const REPO = 'https://github.com/allsmog/Formal-Verify-Anything';
const siteDir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(siteDir, '..', 'docs');

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const nav = [
  ['/how-it-works/', 'How it works'],
  ['/results/', 'Results'],
  ['/guides/', 'Guides'],
  ['/showcase/', 'Showcase'],
];

function render(page, body) {
  // GitHub Pages serves 404.html at any depth, so it links from the site root.
  const depth = page.path.split('/').filter(Boolean).length;
  const root = page.path === '/404.html' ? '/Formal-Verify-Anything/' : depth ? '../'.repeat(depth) : './';
  const url = `${ORIGIN}${page.path}`;
  const card = `${ORIGIN}/assets/social-card.png`;
  const links = nav.map(([href, label]) => {
    const current = page.path.startsWith(href) ? ' aria-current="page"' : '';
    return `<a href="${root}${href.slice(1)}"${current}>${label}</a>`;
  }).join('\n        ');
  const structured = page.structuredData
    ? `\n  <script type="application/ld+json">${JSON.stringify(page.structuredData)}</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(page.title)}</title>
  <meta name="description" content="${escape(page.description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Formal Verify Anything">
  <meta property="og:title" content="${escape(page.title)}">
  <meta property="og:description" content="${escape(page.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${card}">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="640">
  <meta property="og:image:alt" content="Formal Verify Anything: AI agents propose, Lean checks, the kernel decides">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(page.title)}">
  <meta name="twitter:description" content="${escape(page.description)}">
  <meta name="twitter:image" content="${card}">
  <link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&amp;family=STIX+Two+Text:ital,wght@0,400..700;1,400..700&amp;display=swap">
  <link rel="stylesheet" href="${root}style.css">${structured}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site">
    <div class="wrap site-bar">
      <a class="mark" href="${root}"><span class="turnstile" aria-hidden="true">⊢</span> Formal Verify Anything</a>
      <nav aria-label="Site">
        ${links}
        <a href="${REPO}">GitHub</a>
      </nav>
    </div>
  </header>
  <main id="main">
${body.trim()}
  </main>
  <footer class="site">
    <div class="wrap footer-grid">
      <p>Formal Verify Anything is open source under the MIT license.</p>
      <ul>
        <li><a href="${REPO}">Source on GitHub</a></li>
        <li><a href="${REPO}/releases">Releases</a></li>
        <li><a href="${REPO}/discussions">Discussions</a></li>
        <li><a href="${REPO}/blob/main/SECURITY.md">Report a vulnerability</a></li>
      </ul>
    </div>
  </footer>
</body>
</html>
`;
}

const header = /^<!--(\{[\s\S]*?\})-->\s*/;
const pages = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full);
    else if (entry.name.endsWith('.html')) {
      const source = await readFile(full, 'utf8');
      const match = source.match(header);
      if (!match) throw new Error(`${full} has no JSON header`);
      const page = JSON.parse(match[1]);
      for (const key of ['title', 'description', 'path']) {
        if (typeof page[key] !== 'string' || !page[key]) throw new Error(`${full} needs "${key}"`);
      }
      if (page.description.length > 160) throw new Error(`${full}: description over 160 characters`);
      pages.push({ page, body: source.slice(match[0].length) });
    }
  }
}

await collect(path.join(siteDir, 'pages'));
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'assets'), { recursive: true });
for (const { page, body } of pages) {
  const target = page.path === '/404.html' ? path.join(out, '404.html') : path.join(out, page.path, 'index.html');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, render(page, body));
}
await copyFile(path.join(siteDir, 'style.css'), path.join(out, 'style.css'));
await copyFile(path.join(siteDir, 'favicon.svg'), path.join(out, 'assets', 'favicon.svg'));
await copyFile(path.join(siteDir, '..', 'assets', 'social-preview.png'), path.join(out, 'assets', 'social-card.png'));
await writeFile(path.join(out, '.nojekyll'), '');
const listed = pages.filter(({ page }) => page.path !== '/404.html').map(({ page }) => page.path).sort();
await writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${listed.map(p => `  <url><loc>${ORIGIN}${p}</loc></url>`).join('\n')}
</urlset>
`);
await writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
console.log(`Built ${pages.length} pages into docs/`);

import fs from 'node:fs';
import path from 'node:path';
import { tools } from '../src/lib/tools';
import { SITE_URL } from '../src/lib/site';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateSitemap() {
  const baseUrl = SITE_URL;

  // Base routes
  const routes = [
    { url: '/', priority: '1.0', changefreq: 'weekly' }
  ];

  // Tool routes
  tools.forEach(tool => {
    routes.push({
      url: `/tools/${tool.slug}`,
      priority: '0.9',
      changefreq: 'monthly'
    });
  });

  const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${routes.map(route => `
  <url>
    <loc>${baseUrl}${route.url}</loc>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`).join('')}
</urlset>`;

  const publicDir = path.resolve(__dirname, '../public');
  
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const sitemapPath = path.resolve(publicDir, 'sitemap.xml');
  fs.writeFileSync(sitemapPath, sitemapContent.trim());
  console.log(`✅ Sitemap generated at ${sitemapPath} (${routes.length} URLs, ${baseUrl})`);

  // robots.txt is generated from the same baseUrl so the Sitemap: line can
  // never drift away from the host the sitemap actually uses.
  const robotsContent = `User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Twitterbot
Allow: /

User-agent: facebookexternalhit
Allow: /

User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`;

  const robotsPath = path.resolve(publicDir, 'robots.txt');
  fs.writeFileSync(robotsPath, robotsContent);
  console.log(`✅ robots.txt generated at ${robotsPath}`);
}

generateSitemap();

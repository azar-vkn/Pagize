import fs from 'node:fs';
import path from 'node:path';
import { tools } from '../src/lib/tools';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateSitemap() {
  const baseUrl = 'https://pagize.com';
  
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
  console.log(`✅ Sitemap generated at ${sitemapPath}`);
}

generateSitemap();

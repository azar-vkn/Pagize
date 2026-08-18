/**
 * Canonical origin for the deployed site.
 *
 * This is the single source of truth for the public host. It feeds canonical
 * tags, og:url, JSON-LD, robots.txt and sitemap.xml, so changing it here is
 * enough to move the site to a different domain.
 *
 * No trailing slash — callers append their own path.
 */
export const SITE_URL = "https://pagize.vercel.app";

/** Absolute URL for a site-relative path, e.g. absoluteUrl("/tools/merge-pdf"). */
export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

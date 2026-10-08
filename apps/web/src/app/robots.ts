import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const origin = process.env.WEB_ORIGIN ?? ''
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/*/preview/', '/tiles/'] }],
    sitemap: origin ? `${origin}/sitemap.xml` : undefined,
  }
}

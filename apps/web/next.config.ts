import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

/** Until the owner says "launch": INDEXING=on at build time AND as a runtime var is what opens the site to search engines. */
const noindex = process.env.INDEXING !== 'on'

const nextConfig: NextConfig = {
  transpilePackages: ['@seerah/content', '@seerah/db'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ...(noindex ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : []),
        ],
      },
    ]
  },
}

export default nextConfig
initOpenNextCloudflareForDev()

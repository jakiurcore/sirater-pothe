import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Pages are rendered dynamically from D1 (content changes through the MCP server must appear without a rebuild),
// so no incremental cache is configured. Edge caching is done with Cache-Control headers (see next.config.ts).
export default defineCloudflareConfig()

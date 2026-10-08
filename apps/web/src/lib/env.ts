import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getDb } from '@seerah/db'

export async function getEnv(): Promise<CloudflareEnv> {
  return (await getCloudflareContext({ async: true })).env
}
export async function getDatabase() {
  return getDb((await getEnv()).DB)
}

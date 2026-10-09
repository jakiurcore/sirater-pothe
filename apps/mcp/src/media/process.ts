/**
 * Responsive copies of an uploaded picture. Resizing needs real image codecs, which a Worker does not have, so it uses
 * Cloudflare's Images binding (`env.IMAGES`). Without the binding, or if it fails, the original (metadata already stripped)
 * is stored alone and pages simply use it: slower on phones, never broken.
 */
export const VARIANT_WIDTHS = [480, 960, 1600] as const

export interface ImageProcessor {
  /** Returns webp bytes scaled to `width` (never enlarged), or null. */
  resize(bytes: Uint8Array, width: number): Promise<Uint8Array | null>
  /** Re-encodes with EXIF rotation baked into the pixels (for rotated JPEGs/WebPs); null if impossible. */
  bakeOrientation(bytes: Uint8Array, mime: string): Promise<Uint8Array | null>
}

type ImagesBinding = {
  input(stream: ReadableStream<Uint8Array>): { transform(t: Record<string, unknown>): { output(o: Record<string, unknown>): Promise<{ response(): Response }> } }
}

export function imagesProcessor(binding: ImagesBinding | undefined): ImageProcessor | null {
  if (!binding) return null
  const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close() } })
  return {
    async resize(bytes, width) {
      try {
        const out = await binding.input(stream(bytes)).transform({ width, fit: 'scale-down' }).output({ format: 'image/webp', quality: 82 })
        return new Uint8Array(await out.response().arrayBuffer())
      } catch (e) { console.error('images resize failed', e); return null }
    },
    async bakeOrientation(bytes, mime) {
      try {
        const out = await binding.input(stream(bytes)).transform({ rotate: 0 }).output({ format: mime === 'image/webp' ? 'image/webp' : 'image/jpeg', quality: 92 })
        return new Uint8Array(await out.response().arrayBuffer())
      } catch (e) { console.error('images orientation failed', e); return null }
    },
  }
}

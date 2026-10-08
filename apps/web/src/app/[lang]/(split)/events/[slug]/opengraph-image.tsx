import { ImageResponse } from 'next/og'
import { isLang } from '@/lib/i18n'
import { getEventPage } from '@/lib/content'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

/**
 * Text-only share card (no imagery, per the content rules).
 * Satori (the renderer behind next/og) can neither shape Bengali nor parse the Bengali/Arabic fonts' GSUB tables
 * ("lookupType: 5 - substFormat: 3 is not yet supported"), so the card carries only Latin text in the built-in
 * font (brand, era number, years). The real title travels in og:title / og:description, which every platform
 * shows next to the image.
 */
export default async function Image({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params
  if (!isLang(lang)) return new Response('Not found', { status: 404 })
  const page = await getEventPage({ slug, lang })
  if (!page) return new Response('Not found', { status: 404 })
  const y = page.card.hijriYear
  const hijri = y == null ? '' : y < 0 ? `${-y} BH` : `${y} AH`
  const greg = page.card.gregorianApprox == null ? '' : `c. ${page.card.gregorianApprox} CE`
  const dates = [hijri, greg].filter(Boolean).join('   ·   ')
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, background: '#F3EBDD', color: '#22514A', border: '14px solid #2E6A61' }}>
        <div style={{ display: 'flex', width: 34, height: 34, background: '#B48A3C', transform: 'rotate(45deg)' }} />
        <div style={{ display: 'flex', fontSize: 110, fontWeight: 700 }}>Seerah Timeline</div>
        <div style={{ display: 'flex', fontSize: 40, color: '#755819' }}>{`Era ${page.eraN}${dates ? `   ·   ${dates}` : ''}`}</div>
      </div>
    ),
    size,
  )
}

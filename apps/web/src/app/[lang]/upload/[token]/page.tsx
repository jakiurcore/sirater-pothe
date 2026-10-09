import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLang, getMessages, makeFmt } from '@/lib/i18n'
import { getUploadInfo } from '@/lib/content'
import { getEnv } from '@/lib/env'
import { UploadForm } from '@/components/UploadForm'

export const dynamic = 'force-dynamic'
// One file per link, no login, nothing to browse: not an admin panel. Never indexed, never leaks the token as a referrer.
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' }

export default async function UploadPage({ params }: { params: Promise<{ lang: string; token: string }> }) {
  const { lang, token } = await params
  if (!isLang(lang)) notFound()
  const f = makeFmt(lang, getMessages(lang))
  const info = await getUploadInfo(token, lang)
  if (!info.ok) return <main className="page"><div className="uploadcard"><h1>{f.t('upload.title')}</h1><p className="stub" role="alert">{f.t('upload.invalid')}</p></div></main>
  const where = f.t(`upload.where.${info.placement}` as 'upload.where.hero', { n: f.n((info.afterIndex ?? 0) + 1) })
  const kind = f.t(`upload.kind.${info.kind}` as 'upload.kind.map')
  const expires = new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : lang, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(info.expiresAt))
  const mcp = (await getEnv()).MCP_ORIGIN.replace(/\/$/, '')
  return (
    <main className="page">
      <div className="uploadcard">
        <h1>{f.t('upload.title')}</h1>
        <p className="lead">{f.t('upload.intro')}</p>
        <dl className="facts upl">
          {info.eventTitle ? <div><dt>{f.t('upload.event')}</dt><dd>{info.eventTitle}</dd></div> : null}
          <div><dt>{f.t('upload.kind')}</dt><dd>{kind}</dd></div>
          <div><dt>{f.t('upload.where')}</dt><dd>{where}</dd></div>
          <div><dt>{f.t('upload.alt')}</dt><dd>{info.alt}</dd></div>
        </dl>
        <p className="meta">{f.t('upload.expires', { t: expires })}</p>
        <UploadForm token={token} endpoint={`${mcp}/upload/${token}`} />
      </div>
    </main>
  )
}

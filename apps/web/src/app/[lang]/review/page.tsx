import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLang, getMessages, makeFmt } from '@/lib/i18n'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return isLang(lang) ? { title: makeFmt(lang, getMessages(lang)).t('review.title') } : {}
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLang(lang)) notFound()
  const f = makeFmt(lang, getMessages(lang))
  return (
    <main className="page simple">
      <h1>{f.t('review.title')}</h1>
      <p>{f.t('review.soon')}</p>
    </main>
  )
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLang, getMessages, makeFmt } from '@/lib/i18n'
import { getRecallQuestions } from '@/lib/content'
import { ReviewSession } from '@/components/ReviewSession'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return isLang(lang) ? { title: makeFmt(lang, getMessages(lang)).t('review.title'), robots: { index: false } } : {}
}

export default async function ReviewPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLang(lang)) notFound()
  return <main className="page"><ReviewSession questions={await getRecallQuestions(lang)} /></main>
}

/**
 * Generates seed.sql: 5 eras, the gazetteer, approximate routes and 5 SAMPLE events.
 *
 *   pnpm --filter @seerah/db seed:sql          → production-safe seed (events are DRAFTS, needs_verification)
 *   pnpm --filter @seerah/db seed:sql --dev    → also publishes them with placeholder citations (LOCAL DEV ONLY)
 *
 * Nothing here is verified: event text comes from the design mock-up, coordinates are approximate.
 * The owner verifies through the MCP server (publish_event requires confirm_verified).
 */
import { writeFileSync } from 'node:fs'
import { GAZETTEER_SEED } from '@seerah/content/gazetteer'
import { getAyat, getTranslationMeta, ARABIC_DATASET } from '@seerah/content/quran'

const dev = process.argv.includes('--dev')
const prod = process.argv.includes('--prod')
const q = (v: string | number | boolean | null | undefined): string =>
  v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${v.replace(/'/g, "''")}'`
const out: string[] = []
const ins = (table: string, row: Record<string, string | number | boolean | null | undefined>) =>
  out.push(`INSERT OR IGNORE INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`)

// ── eras ──
const ERAS = [
  { slug: 'pre-islamic-arabia', start: null, end: -53, title: 'ইসলামপূর্ব আরব ও জন্মের আগে', range: 'আনু. ৫৭০ খ্রি. পর্যন্ত' },
  { slug: 'childhood-and-youth', start: -53, end: -13, title: 'শৈশব ও যৌবন', range: '৫৭০–৬১০ খ্রি. · বয়স ০–৪০' },
  { slug: 'prophethood-in-makkah', start: -13, end: 1, title: 'মক্কায় নবুয়ত', range: '৬১০–৬২২ খ্রি. · বয়স ৪০–৫৩' },
  { slug: 'hijrah', start: 1, end: 1, title: 'হিজরত', range: '৬২২ খ্রি. · ১ হিজরি' },
  { slug: 'life-in-madinah', start: 1, end: 11, title: 'মদিনার জীবন', range: '৬২২–৬৩২ খ্রি. · ১–১১ হিজরি' },
]
ERAS.forEach((e, i) => {
  const id = `seed-era-${e.slug}`
  ins('eras', { id, slug: e.slug, order_index: (i + 1) * 1024, start_hijri: e.start, end_hijri: e.end })
  // The era subtitle (date range) is stored in `summary`.
  ins('era_translations', { era_id: id, lang: 'bn', title: e.title, summary: e.range })
})

// ── places (gazetteer; all verified = 0) ──
for (const p of GAZETTEER_SEED) {
  const id = `seed-place-${p.slug}`
  ins('places', { id, slug: p.slug, type: p.type, lat: p.lat, lng: p.lng, verified: false, parent_place_id: p.parent ? `seed-place-${p.parent}` : null, zoom_override: p.zoom ?? null })
  for (const [lang, name] of Object.entries(p.names)) ins('place_translations', { place_id: id, lang, name })
}

// --prod: eras + gazetteer places ONLY. No routes, sources or events; real content comes through the MCP server.
if (prod) {
  const f = new URL('./seed.prod.sql', import.meta.url)
  writeFileSync(f, out.join('\n') + '\n')
  console.log(`wrote ${f.pathname} (${out.length} statements, PROD: eras + places only, places unverified)`)
  process.exit(0)
}

// ── routes (approximate; GeoJSON [lng, lat]) ──
const G = Object.fromEntries(GAZETTEER_SEED.map((p) => [p.slug, [p.lng, p.lat] as [number, number]]))
type Pt = string | [number, number]
const pt = (k: Pt) => (typeof k === 'string' ? G[k]! : k)
const ROUTES: { slug: string; name: string; pts: Pt[] }[] = [
  { slug: 'hijrah', name: 'হিজরতের আনুমানিক পথ', pts: ['makkah', 'thawr', [39.55, 21.62], [39.33, 21.97], [39.2, 22.45], [39.1, 22.95], [39.08, 23.45], [39.28, 23.95], [39.5, 24.3], 'quba', 'madinah'] },
  { slug: 'elephant', name: 'আবরাহার বাহিনীর আনুমানিক পথ', pts: ['sanaa', [44.13, 17.49], [43.1, 18.8], [41.9, 19.9], [40.9, 20.8], 'taif', 'makkah'] },
  { slug: 'halima', name: "বনু সা'দের দিকে", pts: ['makkah', [40.2, 21.25], 'banu-sad'] },
  { slug: 'abwa', name: 'ইয়াসরিব থেকে ফেরার পথ', pts: ['madinah', [39.4, 24.0], [39.15, 23.5], 'abwa'] },
  { slug: 'habasha', name: 'হাবশার পথে, সমুদ্রপথসহ', pts: ['makkah', [39.3, 21.15], [39.0, 20.6], [38.7, 18.5], [38.8, 16.2], 'aksum'] },
  { slug: 'isra', name: 'রাত্রিকালীন সফর', pts: ['makkah', [37.2, 27.0], 'bayt-al-maqdis'] },
  { slug: 'fath', name: 'মদিনা থেকে মক্কার পথে', pts: ['madinah', [39.8, 23.6], [39.9, 22.6], [39.85, 21.9], 'makkah'] },
]
for (const r of ROUTES) {
  const id = `seed-route-${r.slug}`
  ins('routes', { id, slug: r.slug, geojson: JSON.stringify({ type: 'LineString', coordinates: r.pts.map(pt) }) })
  ins('route_translations', { route_id: id, lang: 'bn', name: r.name })
}

// ── sources (books only; no page numbers are invented) ──
const SRC = {
  hisham: { slug: 'ibn-hisham-sirah', book: 'আস-সীরাতুন নাবাবিয়্যাহ', author: 'ইবনে হিশাম' },
  rahiq: { slug: 'ar-rahiq-al-makhtum', book: 'আর-রাহীকুল মাখতূম', author: 'সফিউর রহমান মুবারকপুরী' },
  bukhari: { slug: 'sahih-al-bukhari', book: 'সহীহ বুখারী', author: 'ইমাম বুখারী' },
  muslim: { slug: 'sahih-muslim', book: 'সহীহ মুসলিম', author: 'ইমাম মুসলিম' },
} as const
for (const s of Object.values(SRC)) ins('sources', { id: `seed-source-${s.slug}`, ...s })

// ── sample events ──
interface Ev {
  slug: string; era: string; order: number; hijri: number | null; greg: number | null; age: number | null
  place: string; route?: string; certainty: 'agreed' | 'disputed'
  title: string; summary: string; key?: string[]; lessons?: string[]; dispute?: string
  ayah?: { surah: number; ayah: number; ayahTo?: number }
  src: (keyof typeof SRC)[]
  recall?: { q: string; a: string; d: string[] }[]
}
const EVENTS: Ev[] = [
  {
    slug: 'year-of-the-elephant', era: 'pre-islamic-arabia', order: 1, hijri: -53, greg: 570, age: null, place: 'makkah', route: 'elephant', certainty: 'agreed',
    title: 'হস্তীবাহিনীর বছর',
    summary: 'ইয়েমেনের শাসক আবরাহা কাবা ধ্বংস করার উদ্দেশ্যে হাতিসহ বিশাল এক বাহিনী নিয়ে মক্কার দিকে অগ্রসর হয়। মক্কার উপকণ্ঠে পৌঁছালে আল্লাহ ঝাঁকে ঝাঁকে পাখি পাঠান; তারা পোড়ামাটির কঙ্কর নিক্ষেপ করে এবং বাহিনীটি ধ্বংস হয়ে যায়। আরবরা এই বছরকে "আমুল ফীল" নামে স্মরণ করত, আর এ বছরেই নবীজি ﷺ জন্মগ্রহণ করেন।',
    key: ['আবরাহা সানআয় একটি বিশাল গির্জা নির্মাণ করে আরবদের হজ সেদিকে ফিরিয়ে নিতে চেয়েছিল।', 'মক্কার নেতা আবদুল মুত্তালিব আবরাহার কাছে শুধু নিজের উট ফেরত চান এবং বলেন, এই ঘরের একজন রব আছেন, তিনিই একে রক্ষা করবেন।', 'মক্কাবাসী আশপাশের পাহাড়ে আশ্রয় নেয়; কাবা রক্ষা পায় আল্লাহর সরাসরি হস্তক্ষেপে।'],
    lessons: ['আল্লাহর ঘরের হেফাজতকারী আল্লাহ নিজেই।', 'শক্তি ও সংখ্যার অহংকার আল্লাহর ইচ্ছার সামনে টেকে না।', 'নবুয়তের আগেই আল্লাহ মক্কার মর্যাদা স্পষ্ট করে দেন।'],
    ayah: { surah: 105, ayah: 1 }, src: ['hisham', 'rahiq'],
    recall: [{ q: 'হস্তীবাহিনীর শেষ পরিণতি কী হয়েছিল?', a: 'পাখির নিক্ষিপ্ত কঙ্করে ধ্বংস হয়', d: ['কাবা ক্ষতিগ্রস্ত করে ফিরে যায়', 'মক্কাবাসীর সাথে সন্ধি করে', 'নিরাপদে ইয়েমেনে ফিরে যায়'] }],
  },
  {
    slug: 'birth-of-the-prophet', era: 'childhood-and-youth', order: 2, hijri: -53, greg: 570, age: 0, place: 'makkah', certainty: 'disputed',
    title: 'নবীজির ﷺ জন্ম',
    dispute: 'রবিউল আউয়াল মাসের এক সোমবার জন্ম, এ বিষয়ে সবাই একমত। তারিখ নিয়ে মতভেদ আছে: প্রসিদ্ধ মত ১২ রবিউল আউয়াল, আর আর-রাহীকুল মাখতূমে ৯ রবিউল আউয়াল উল্লেখ করা হয়েছে।',
    summary: 'হস্তীবাহিনীর বছরে, রবিউল আউয়াল মাসের এক সোমবার মক্কায় বনু হাশিম গোত্রে নবীজি ﷺ জন্মগ্রহণ করেন। তাঁর মা আমিনা, আর দাদা আবদুল মুত্তালিব তাঁর নাম রাখেন মুহাম্মাদ ﷺ।',
    key: ['পিতা আবদুল্লাহ তাঁর জন্মের আগেই ইন্তেকাল করেন; দাদা আবদুল মুত্তালিব তাঁর অভিভাবক হন।', 'সোমবারে রোজা রাখা প্রসঙ্গে নবীজি ﷺ বলেছেন, এ দিনেই তাঁর জন্ম হয়েছে (সহীহ মুসলিম)।', 'আরব রীতি অনুযায়ী শিগগিরই তাঁকে দুধমায়ের কাছে মরুভূমিতে পাঠানোর প্রস্তুতি নেওয়া হয়।'],
    lessons: ['আল্লাহ তাঁর রাসূলকে ﷺ ইয়াতীম অবস্থায় বড় করেছেন; তিনিই ছিলেন তাঁর প্রকৃত অভিভাবক।', 'বংশমর্যাদা ও পরিবেশ, দুটোই নবুয়তের দায়িত্বের জন্য প্রস্তুত ছিল।'],
    src: ['muslim', 'hisham', 'rahiq'],
  },
  {
    slug: 'first-revelation-in-hira', era: 'prophethood-in-makkah', order: 3, hijri: -13, greg: 610, age: 40, place: 'hira', certainty: 'agreed',
    title: 'হেরা গুহায় প্রথম ওহী',
    summary: 'নবুয়তের আগের বছরগুলোতে নবীজি ﷺ মক্কার কাছে জাবালে নূরের হেরা গুহায় নির্জনে ইবাদতে সময় কাটাতেন। চল্লিশ বছর বয়সে রমজান মাসে সেখানেই প্রথম ওহী নাযিল হয়: সূরা আল-আলাকের প্রথম পাঁচটি আয়াত। এর মধ্য দিয়েই নবুয়তের সূচনা হয়।',
    key: ['জিবরাঈল (আ.) এসে বলেন "পড়ুন"; নবীজি ﷺ উত্তর দেন, "আমি পড়তে জানি না।"', 'ঘরে ফিরে তিনি খাদিজা (রা.)-কে বলেন, "আমাকে চাদর দিয়ে ঢেকে দাও।" খাদিজা (রা.) তাঁকে সান্ত্বনা দেন এবং তাঁর উত্তম চরিত্রের কথা স্মরণ করিয়ে দেন।', 'খাদিজা (রা.) তাঁকে নিয়ে যান চাচাতো ভাই ওয়ারাকা ইবনে নাওফালের কাছে, যিনি একে নবুয়তের সূচনা বলে চিনতে পারেন।'],
    lessons: ['ইসলামের প্রথম আদেশটিই ছিল পড়া ও জ্ঞান অর্জনের।', 'কঠিন মুহূর্তে জীবনসঙ্গীর আস্থা ও সান্ত্বনা অমূল্য।', 'নির্জনে চিন্তা ও ইবাদত বড় দায়িত্বের জন্য হৃদয়কে প্রস্তুত করে।'],
    ayah: { surah: 96, ayah: 1 }, src: ['bukhari', 'rahiq'],
    recall: [
      { q: 'প্রথম ওহী কোথায় নাযিল হয়?', a: 'হেরা গুহায়', d: ['সাওর গুহায়', 'মসজিদে কুবায়', 'সাফা পাহাড়ে'] },
      { q: 'প্রথম ওহীর সময় নবীজির ﷺ বয়স কত ছিল?', a: '৪০ বছর', d: ['২৫ বছর', '৩৫ বছর', '৫৩ বছর'] },
    ],
  },
  {
    slug: 'hijrah-to-madinah', era: 'hijrah', order: 4, hijri: 1, greg: 622, age: 53, place: 'madinah', route: 'hijrah', certainty: 'agreed',
    title: 'হিজরত, মক্কা থেকে মদিনা',
    summary: 'কুরাইশরা নবীজিকে ﷺ হত্যার ষড়যন্ত্র করলে আল্লাহর নির্দেশে তিনি আবু বকর (রা.)-কে সঙ্গে নিয়ে রাতের অন্ধকারে মক্কা ত্যাগ করেন। তাঁরা তিন রাত সাওর গুহায় আত্মগোপন করেন, তারপর প্রচলিত পথ এড়িয়ে উপকূলের দিক দিয়ে মদিনার পথে যাত্রা করেন। কুবায় কয়েক দিন অবস্থানের পর তিনি মদিনায় প্রবেশ করেন; পরে এই ঘটনা থেকেই হিজরি সনের গণনা শুরু হয়।',
    key: ['যে রাতে ঘাতকেরা ঘর ঘিরে রেখেছিল, আলী (রা.) নবীজির ﷺ বিছানায় শুয়ে থাকেন এবং পরে মানুষের গচ্ছিত আমানত ফেরত দেন।', 'সাওর গুহায় তিন রাত: আবদুল্লাহ ইবনে আবু বকর মক্কার খবর আনতেন, আর আসমা বিনতে আবু বকর (রা.) খাবার পৌঁছে দিতেন।', 'পথপ্রদর্শক আবদুল্লাহ ইবনে উরাইকিত তাঁদের অপ্রচলিত উপকূলীয় পথে নিয়ে যান।', 'কুবায় পৌঁছে নবীজি ﷺ মসজিদে কুবার ভিত্তি স্থাপন করেন, যা ইসলামের প্রথম মসজিদ।'],
    lessons: ['আল্লাহর ওপর ভরসা আর সতর্ক পরিকল্পনা একসাথে চলে।', 'শত্রুর গচ্ছিত আমানতও ফেরত দেওয়া ঈমানের দাবি।', 'দ্বীনের জন্য পুরো পরিবার যার যার সামর্থ্যে অংশ নিয়েছিল।'],
    ayah: { surah: 9, ayah: 40 }, src: ['bukhari', 'hisham', 'rahiq'],
  },
  {
    slug: 'battle-of-badr', era: 'life-in-madinah', order: 5, hijri: 2, greg: 624, age: 54, place: 'badr', certainty: 'agreed',
    title: 'বদরের যুদ্ধ',
    summary: 'রমজান মাসে বদর প্রান্তরে প্রায় ৩১৩ জন মুসলিম তিন গুণের বেশি সংখ্যক কুরাইশ বাহিনীর মুখোমুখি হন। আল্লাহর সাহায্যে মুসলিমরা বিজয়ী হন; কুরআনে এই দিনকে "ইয়াওমুল ফুরকান" বলা হয়েছে।',
    src: ['hisham', 'rahiq'],
  },
]

const datasetRows = new Set<string>()
EVENTS.forEach((e, i) => {
  const id = `seed-event-${e.slug}`
  const status = dev ? 'published' : 'draft'
  ins('events', {
    id, slug: e.slug, era_id: `seed-era-${e.era}`, order_index: (i + 1) * 1024, hijri_year: e.hijri, gregorian_approx: e.greg, prophet_age: e.age,
    place_id: `seed-place-${e.place}`, route_id: e.route ? `seed-route-${e.route}` : null, certainty: e.certainty, status,
    needs_verification: !dev, published_at: dev ? new Date().toISOString() : null,
  })
  ins('event_places', { event_id: id, place_id: `seed-place-${e.place}`, role: 'primary', order_index: 0 })
  ins('event_translations', {
    event_id: id, lang: 'bn', title: e.title, summary: e.summary, key_details: JSON.stringify(e.key ?? []), lessons: JSON.stringify(e.lessons ?? []),
    dispute_note: e.dispute ?? null, status: dev ? 'published' : 'draft',
  })
  if (dev) for (const s of e.src) ins('event_sources', { id: `seed-cite-${e.slug}-${s}`, event_id: id, source_id: `seed-source-${SRC[s].slug}`, volume: null, page: '(dev placeholder)', note: 'LOCAL DEV ONLY. Not a real citation.' })
  if (e.ayah) {
    const ref = { ...e.ayah, ayahTo: e.ayah.ayahTo ?? e.ayah.ayah }
    const meta = getTranslationMeta('bn')
    if (!datasetRows.has('x')) {
      datasetRows.add('x')
      ins('content_datasets', { id: ARABIC_DATASET.id, kind: 'arabic', lang: 'ar', name: ARABIC_DATASET.name, license: ARABIC_DATASET.license })
      if (meta) ins('content_datasets', { id: meta.id, kind: 'translation', lang: 'bn', name: meta.name, license: meta.license })
    }
    getAyat(ref, 'bn').forEach((t, j) => {
      const aid = `${t.surah}:${t.ayah}`
      ins('ayat', { id: aid, surah: t.surah, ayah: t.ayah, arabic_text: t.arabic, arabic_source: ARABIC_DATASET.id })
      if (t.translation !== undefined && meta) ins('ayah_translations', { ayah_id: aid, lang: 'bn', text: t.translation, translation_source: meta.id, translation_license: meta.license })
      ins('event_ayat', { event_id: id, ayah_id: aid, order_index: j })
    })
  }
  e.recall?.forEach((r, j) => {
    const qid = `seed-q-${e.slug}-${j}`
    ins('recall_questions', { id: qid, event_id: id, order_index: j })
    ins('recall_question_translations', { question_id: qid, lang: 'bn', question: r.q, answer: r.a, distractors: JSON.stringify(r.d) })
  })
})

const file = new URL(dev ? './seed.dev.sql' : './seed.sql', import.meta.url)
writeFileSync(file, out.join('\n') + '\n')
console.log(`wrote ${file.pathname} (${out.length} statements, ${dev ? 'DEV: events published' : 'events are drafts'})`)

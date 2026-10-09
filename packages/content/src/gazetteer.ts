/**
 * Seed gazetteer of places for Seerah events. Coordinates are approximate (±1 km for sites, more for
 * regions) and EVERY entry is unverified: the owner must confirm before relying on them.
 */
import type { PlaceType } from './geo'
export type { PlaceType } from './geo'

export interface GazetteerPlace {
  slug: string
  type: PlaceType
  lat: number
  lng: number
  /** Slug of the containing place (a site's city). */
  parent?: string
  /** Optional zoom override (otherwise the type's default). */
  zoom?: number
  names: { bn: string; en: string; ar: string }
  verified: false
}

const p = (slug: string, type: PlaceType, lat: number, lng: number, bn: string, en: string, ar: string, extra: { parent?: string; zoom?: number } = {}): GazetteerPlace =>
  ({ slug, type, lat, lng, names: { bn, en, ar }, verified: false, ...extra })

export const GAZETTEER_SEED: readonly GazetteerPlace[] = [
  p('makkah', 'city', 21.4225, 39.826, 'মক্কা', 'Makkah', 'مكة المكرمة'),
  p('madinah', 'city', 24.4686, 39.6111, 'মদিনা', 'Madinah', 'المدينة المنورة'),
  p('taif', 'city', 21.2703, 40.4158, 'তায়েফ', "Ta'if", 'الطائف'),
  p('hira', 'site', 21.4576, 39.8579, 'হেরা গুহা', 'Cave of Hira', 'غار حراء', { zoom: 15 }),
  p('thawr', 'site', 21.3772, 39.8497, 'সাওর গুহা', 'Cave of Thawr', 'غار ثور', { zoom: 15 }),
  p('badr', 'site', 23.73, 38.775, 'বদর', 'Badr', 'بدر', { zoom: 13 }),
  p('uhud', 'site', 24.5017, 39.6122, 'উহুদ', 'Uhud', 'أحد', { zoom: 13 }),
  p('quba', 'site', 24.4393, 39.6173, 'কুবা', 'Quba', 'قباء'),
  p('arafat', 'site', 21.355, 39.984, 'আরাফাহ', 'Arafah', 'عرفة', { zoom: 13 }),
  p('mina', 'site', 21.4133, 39.8933, 'মিনা', 'Mina', 'منى', { zoom: 13 }),
  p('muzdalifah', 'site', 21.3833, 39.9, 'মুযদালিফা', 'Muzdalifah', 'مزدلفة', { zoom: 13 }),
  p('abwa', 'site', 23.08, 39.08, 'আবওয়া', "Al-Abwa'", 'الأبواء'),
  p('banu-sad', 'region', 21.0, 40.6, "বনু সা'দ", "Banu Sa'd", 'بنو سعد'),
  p('hudaybiyyah', 'site', 21.4, 39.65, 'হুদাইবিয়া', 'Al-Hudaybiyyah', 'الحديبية'),
  p('hunayn', 'site', 21.3, 40.3, 'হুনাইন', 'Hunayn', 'حنين', { zoom: 13 }),
  p('khaybar', 'site', 25.7, 39.29, 'খায়বার', 'Khaybar', 'خيبر'),
  p('tabuk', 'city', 28.3838, 36.5662, 'তাবুক', 'Tabuk', 'تبوك'),
  p('sanaa', 'city', 15.3694, 44.2067, 'সানআ', "San'a", 'صنعاء'),
  p('aksum', 'city', 14.13, 38.72, 'হাবশা (আকসুম)', 'Aksum (Abyssinia)', 'أكسوم'),
  p('bayt-al-maqdis', 'city', 31.7767, 35.2355, 'বায়তুল মাকদিস', 'Bayt al-Maqdis', 'بيت المقدس'),
  // Sites inside Makkah. Kaaba: OpenStreetMap way 103914569 (centroid). Zamzam: Wikipedia "Zamzam Well" (21.4220, 39.8260, only
  // 3 decimals, ~100 m) which disagrees with its own text ("20 m east of the Kaaba"): the owner must verify both.
  p('masjid-al-haram', 'site', 21.4225079, 39.826189, 'মাসজিদুল হারাম (কাবা)', 'Masjid al-Haram (the Kaaba)', 'المسجد الحرام (الكعبة)', { parent: 'makkah' }),
  p('zamzam', 'site', 21.422, 39.826, 'জমজম কূপ', 'Zamzam well', 'بئر زمزم', { parent: 'makkah' }),
]

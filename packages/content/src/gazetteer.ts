/**
 * Seed gazetteer of places for Seerah events. Coordinates are approximate (±1 km for sites, more for
 * regions) and EVERY entry is unverified: the owner must confirm before relying on them.
 */
export type PlaceType = 'city' | 'mountain' | 'cave' | 'valley' | 'plain' | 'battlefield' | 'region' | 'site'

export interface GazetteerPlace {
  slug: string
  type: PlaceType
  lat: number
  lng: number
  names: { bn: string; en: string; ar: string }
  verified: false
}

const p = (slug: string, type: PlaceType, lat: number, lng: number, bn: string, en: string, ar: string): GazetteerPlace =>
  ({ slug, type, lat, lng, names: { bn, en, ar }, verified: false })

export const GAZETTEER_SEED: readonly GazetteerPlace[] = [
  p('makkah', 'city', 21.4225, 39.826, 'মক্কা', 'Makkah', 'مكة المكرمة'),
  p('madinah', 'city', 24.4686, 39.6111, 'মদিনা', 'Madinah', 'المدينة المنورة'),
  p('taif', 'city', 21.2703, 40.4158, 'তায়েফ', "Ta'if", 'الطائف'),
  p('hira', 'cave', 21.4576, 39.8579, 'হেরা গুহা', 'Cave of Hira', 'غار حراء'),
  p('thawr', 'cave', 21.3772, 39.8497, 'সাওর গুহা', 'Cave of Thawr', 'غار ثور'),
  p('badr', 'battlefield', 23.73, 38.775, 'বদর', 'Badr', 'بدر'),
  p('uhud', 'battlefield', 24.5017, 39.6122, 'উহুদ', 'Uhud', 'أحد'),
  p('quba', 'site', 24.4393, 39.6173, 'কুবা', 'Quba', 'قباء'),
  p('arafat', 'plain', 21.355, 39.984, 'আরাফাহ', 'Arafah', 'عرفة'),
  p('mina', 'valley', 21.4133, 39.8933, 'মিনা', 'Mina', 'منى'),
  p('muzdalifah', 'plain', 21.3833, 39.9, 'মুযদালিফা', 'Muzdalifah', 'مزدلفة'),
  p('abwa', 'site', 23.08, 39.08, 'আবওয়া', "Al-Abwa'", 'الأبواء'),
  p('banu-sad', 'region', 21.0, 40.6, "বনু সা'দ", "Banu Sa'd", 'بنو سعد'),
  p('hudaybiyyah', 'site', 21.4, 39.65, 'হুদাইবিয়া', 'Al-Hudaybiyyah', 'الحديبية'),
  p('hunayn', 'valley', 21.3, 40.3, 'হুনাইন', 'Hunayn', 'حنين'),
  p('khaybar', 'site', 25.7, 39.29, 'খায়বার', 'Khaybar', 'خيبر'),
  p('tabuk', 'city', 28.3838, 36.5662, 'তাবুক', 'Tabuk', 'تبوك'),
  p('sanaa', 'city', 15.3694, 44.2067, 'সানআ', "San'a", 'صنعاء'),
  p('aksum', 'city', 14.13, 38.72, 'হাবশা (আকসুম)', 'Aksum (Abyssinia)', 'أكسوم'),
  p('bayt-al-maqdis', 'city', 31.7767, 35.2355, 'বায়তুল মাকদিস', 'Bayt al-Maqdis', 'بيت المقدس'),
]

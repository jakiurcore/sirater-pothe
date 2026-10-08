# Design audit: /design vs the live site

Method: `apps/web/scripts/design-audit.mjs` renders the seven /design artboards (1a home, 1b timeline, 1c event, 1d event dark,
1e review, 1f progress, 1g desktop split) and the live site (14 page states × widths 360, 390, 768, 1024, 1280, 1440 = 84 captures)
with the same Chromium, and records layout metrics per capture (horizontal overflow, elements outside the viewport, clipped text,
interactive elements under 44 px). Side-by-side composites: `design-audit/compare/before/`, raw metrics:
`design-audit/live/before/metrics.json`. /design only defines two form factors (390 mobile, 1280 desktop split), so at 360, 768,
1024 and 1440 the check is "behaves like the nearest design, with no overflow or broken layout".

Status column is updated after the fixes. After-fix captures: `design-audit/compare/after/`, `design-audit/live/after/metrics.json` (84 captures: 0 overflow, 0 clipped text, 0 targets under 44 px).

## Differences found (before any fix)

| # | Where | Difference | Severity | Status |
|---|---|---|---|---|
| 1 | Home eras, Timeline era headers, all widths | Numeral inside the era circle is invisible on completed eras (teal on teal) and wrong colour (ink-2 instead of primary-strong) on the others: `.tl header .top span`/`.pagehead span` out-specify `.circ`. Design: on-primary on filled, primary-strong on outline. | high | fixed: `.circ.circ` / `.circ.circ.done` (colour **and** font; the context rule was also shrinking the numeral to 13 px). Compared against 1a/1b. |
| 2 | Language dropdown (the only dropdown/menu on the site), all widths | `ul` is absolutely positioned with no max-height, no scroll, no flip. 10 languages × 44 px = 460 px tall: clipped by the viewport on short screens (landscape phones, 360×640, desktop with a small window). Also does not close on Escape or outside click. | high (reported bug 1 and 2) | fixed: client component, `position: fixed` from the button rect, `max-height` = room to the viewport edge, `overflow-y: auto`, flips up when there is more room above, clamps horizontally (RTL aware), closes on Escape / outside press / navigation / resize, focus returns to the button. Tests: opens inside viewport, scrolls in a 190 px viewport, flips, survives an `overflow:hidden` ancestor. (Currently 3 UI languages, so the list is short; it is built for 10.) |
| 3 | 600–899 px (tablet / large phone / split-screen) | The mobile layout just stretches: body copy runs to ~110 characters per line, cards are 700 px wide, the map is 768 × 280. The design has no tablet layout; nearest design is mobile. | high (reported "not responsive") | fixed: 600–899 px keeps the mobile layout in a centred 720 px column (timeline + page header), 340 px map, 60 px tab bar. Event/home/review/progress were already capped (680/720 px). |
| 4 | 900–1100 px, event page | Facts grid (hijri / gregorian / age / place) wraps 3 + 1 because the right pane is only ~650 px. Design: 4 across on desktop. | medium | fixed: container query on the article: 2 columns, 4 columns from 520 px of article width (design desktop shows 4). |
| 5 | Event page, map attribution (all widths) | "Protomaps" and "OpenStreetMap" links are 51 × 18 and 76 × 18; the attribution toggle is 24 × 24. Below the 44 px minimum. (Attribution must stay: ODbL.) | medium | fixed: attribution links `inline-flex`, `min-height: 44px`; toggle 44 × 44. The attribution itself stays (ODbL). |
| 6 | Review, question header link | Event-name link is 80 × 22. | low | fixed: event link in the review card is 44 px tall. |
| 7 | Desktop top bar brand link | 169 × 27 px. | low | fixed: brand link `min-height: 44px`. |
| 8 | Skip link | 136 × 34 px when focused. | low | fixed: skip link 44 px tall. |
| 9 | `next dev` only | The Next.js dev indicator covers the first tab of the bottom bar. Not present in production builds; removed from dev so screenshots and tests are clean. | none (dev only) | fixed: `devIndicators: false` (dev only). |
| 10 | Long Bangla titles / conjuncts | No clipped text found in the 84 captures, but there is no fixture with a very long title; added one (`e2e-long-title`) to the visual tests at 360 and 390. | check | fixed/verified: new draft fixture with a 120-character title full of conjuncts; wraps correctly at 390 and 1280 (snapshot + no-clipping test). No Bangla clipping found anywhere. |
| 11 | Modals | There are **no modals** on the site (no dialog, sheet or popover other than the language `<details>` menu). The modal rules (internal scroll, reachable close button, body scroll lock) are therefore applied to the dropdown (internal scroll, fixed positioning so no ancestor can clip it) and to the new login page; nothing else exists to fix. | n/a | n/a, explained: no modals exist; the dropdown follows the modal rules (see 2). |
| 12 | Login page (MCP `/authorize`) | New page, no design artboard. Built from the same tokens (surface card, 20 px radius, 50 px pill buttons, Hind Siliguri / Noto Serif Bengali, geometric pattern, dark mode). | n/a | done |

## Differences that are deliberate (not bugs)

| # | Where | Why |
|---|---|---|
| A | Home hero caption: design "মুহাম্মাদ আল্লাহর রাসূল", live "মুহাম্মাদ ﷺ আল্লাহর রাসূল" | Content rule: ﷺ is always rendered after the Prophet's name. |
| B | Event facts: design "৬২২ খ্রি.", live "আনু. ৬২২ খ্রি." | The Gregorian year is stored as `gregorian_approx`; claiming exactness would be wrong. |
| C | Event ayah block: design shows an excerpt, live shows the whole referenced ayah | Qur'an text comes only from the bundled Tanzil dataset by surah:ayah reference; we never cut it. Same type spec (30 px / 2, Amiri). |
| D | Review card: design has a type tag ("স্থান") | The data model has no question type; a link to the event is shown instead. |
| E | Counts (e.g. "১০ / ১৬"), dates, sample copy | Design numbers are sample data; live numbers come from D1 and local reader state. |
| F | Source list shows "dev placeholder" citations | Local dev seed only; production seed has no events. |

## Not matched exactly / found while fixing

- Deliberate deviations A–F above stay (content rules and real data).
- The /design artboard frames have a 1 px border and rounded corners (presentation chrome); the live page has none. Not copied.
- At 360 px the tab bar labels are 12.5 px as designed; no change.
- Bug found by the new tests while doing this: event pages lost the pre-launch `<meta robots noindex>` because the page set `robots: undefined`, which overrides the layout value (the `X-Robots-Tag` header and robots.txt were unaffected). Fixed; covered by the SEO test.
- Preview banner: the expiry time was rendered in the server's timezone without saying so; now explicit UTC.
- Visual snapshots were generated on this machine (Arch, system Chromium, WebGL masked). CI runs on Ubuntu: if font hinting differs, regenerate with `pnpm e2e design --update-snapshots` on CI once and commit. Tolerance is 2 % of pixels.

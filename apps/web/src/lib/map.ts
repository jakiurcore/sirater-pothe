'use client'
/**
 * MapLibre map for the event page: Protomaps PMTiles (self-hosted on R2) styled with the design's palette.
 * Behaviour from design/seerah-map.js: fly to the event, pulsing highlighted marker, approximate route drawn
 * progressively, sea labels, 2° graticule, theme switch, reduced motion.
 * Labels are HTML markers (not map symbols) so Bangla text uses the page fonts and needs no glyph server.
 */
import type { Map as MLMap, Marker, LngLatBoundsLike, GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { TILE_DETAIL_AREAS } from '@seerah/content/geo'
import type { MapData } from './content'

type LL = [number, number]
export const PENINSULA: [LL, LL] = [[34, 12.5], [60, 32]]
const SEAS = [
  { key: 'map.sea.red', c: [38.1, 22.3] as LL, rot: 56 },
  { key: 'map.sea.gulf', c: [51.3, 27.2] as LL, rot: 28 },
]
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const MAX_ZOOM = 9.6

export interface MapOptions {
  tilesUrl: string
  seaLabel: (key: string) => string
  ariaLabel: (places: string) => string
}

function graticule(step = 2): FeatureCollection {
  const features: Feature[] = []
  const line = (coordinates: LL[]): Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })
  for (let lng = 20; lng <= 70; lng += step) features.push(line([[lng, 0], [lng, 45]]))
  for (let lat = 0; lat <= 45; lat += step) features.push(line([[20, lat], [70, lat]]))
  return { type: 'FeatureCollection', features }
}

/** Centripetal Catmull-Rom through the points, like d3.curveCatmullRom.alpha(0.5) in the design. */
export function smooth(pts: LL[], per = 14): LL[] {
  if (pts.length < 3) return pts
  const out: LL[] = []
  const P = [pts[0]!, ...pts, pts[pts.length - 1]!]
  const knot = (a: LL, b: LL, t: number) => t + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5)
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1]!, P[i]!, P[i + 1]!, P[i + 2]!]
    const t0 = 0, t1 = knot(p0, p1, t0), t2 = knot(p1, p2, t1), t3 = knot(p2, p3, t2)
    if (t2 - t1 === 0) continue
    for (let s = 0; s < per; s++) {
      const t = t1 + ((t2 - t1) * s) / per
      const at = (a: LL, b: LL, ta: number, tb: number, k: number): LL => (tb === ta ? a : [a[0] + ((b[0] - a[0]) * (k - ta)) / (tb - ta), a[1] + ((b[1] - a[1]) * (k - ta)) / (tb - ta)])
      const A1 = at(p0, p1, t0, t1, t), A2 = at(p1, p2, t1, t2, t), A3 = at(p2, p3, t2, t3, t)
      const B1 = at(A1, A2, t0, t2, t), B2 = at(A2, A3, t1, t3, t)
      out.push(at(B1, B2, t1, t2, t))
    }
  }
  out.push(pts[pts.length - 1]!)
  return out
}

export function boundsFor(data: MapData): [LL, LL] {
  const pts: LL[] = [...data.markers.map((m): LL => [m.lng, m.lat]), ...(data.route?.coordinates ?? [])]
  if (!pts.length) return PENINSULA
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y) }
  // Without a primary place (so no zoom to respect) never go closer than ~0.7° across (about zoom 9.5).
  // With one, fitBounds is capped by that place's zoom instead, so a few nearby sites can fill the view.
  if (data.maxZoom == null) {
    const minSpan = 0.7
    if (e - w < minSpan) { const c = (e + w) / 2; w = c - minSpan / 2; e = c + minSpan / 2 }
    if (n - s < minSpan) { const c = (n + s) / 2; s = c - minSpan / 2; n = c + minSpan / 2 }
  }
  return [[w, s], [e, n]]
}

export class SeerahMap {
  private ml!: typeof import('maplibre-gl')
  private map!: MLMap
  private markers: Marker[] = []
  private seaMarkers: Marker[] = []
  private anim = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: MapData | null | undefined
  private shown: MapData | null = null
  private ready = false
  private dead = false
  private mo?: MutationObserver
  private ro?: ResizeObserver
  private first = true

  constructor(private el: HTMLElement, private opts: MapOptions) {}

  private css(name: string) { return getComputedStyle(this.el).getPropertyValue(name).trim() }
  private get reduced() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced'
  }

  async init() {
    const ml = (this.ml = await import('maplibre-gl'))
    const { Protocol } = await import('pmtiles')
    if (!(globalThis as { __seerahPm?: boolean }).__seerahPm) {
      ml.addProtocol('pmtiles', new Protocol().tile)
      ;(globalThis as { __seerahPm?: boolean }).__seerahPm = true
    }
    ml.setWorkerUrl(`${location.origin}/vendor/maplibre/maplibre-gl-worker.mjs`)
    if (this.dead) return
    const style: StyleSpecification = {
      version: 8,
      sources: {
        protomaps: {
          type: 'vector',
          url: `pmtiles://${this.opts.tilesUrl}`,
          attribution: '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
        },
        ...Object.fromEntries(TILE_DETAIL_AREAS.map((a) => [`detail-${a.id}`, {
          type: 'vector' as const,
          url: `pmtiles://${this.opts.tilesUrl.replace(/[^/]+$/, a.file)}`,
          bounds: [...a.bbox] as [number, number, number, number],
        }])),
        grid: { type: 'geojson', data: graticule() },
        routeBase: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        routeMain: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'sea', type: 'background', paint: { 'background-color': this.css('--map-sea') || '#DDE3DA' } },
        { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: { 'fill-color': this.css('--map-land') || '#F0E6D2' } },
        { id: 'lakes', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': this.css('--map-sea') || '#DDE3DA' } },
        { id: 'coast', type: 'line', source: 'protomaps', 'source-layer': 'earth', layout: { 'line-join': 'round' }, paint: { 'line-color': this.css('--map-coast') || '#B7A687', 'line-width': 1 } },
        ...this.detailLayers(),
        { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': this.css('--map-grid') || 'rgba(46,106,97,.1)', 'line-width': 1 } },
        { id: 'route-base', type: 'line', source: 'routeBase', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': this.css('--map-route') || '#2E6A61', 'line-width': 7, 'line-opacity': 0, 'line-opacity-transition': { duration: 1000, delay: 0 } } },
        { id: 'route-main', type: 'line', source: 'routeMain', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': this.css('--map-route') || '#2E6A61', 'line-width': 2.5 } },
      ],
    }
    this.map = new ml.Map({
      container: this.el,
      style,
      bounds: PENINSULA as LngLatBoundsLike,
      fitBoundsOptions: { padding: this.padding() },
      attributionControl: false,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      renderWorldCopies: false,
      fadeDuration: 0,
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right')
    this.map.on('error', (e) => { if (process.env.NODE_ENV !== 'production') console.warn('map', e.error?.message) })
    await new Promise<void>((res) => (this.map.loaded() ? res() : this.map.once('load', () => res())))
    if (this.dead) return
    this.ready = true
    this.seaMarkers = SEAS.map((s) => {
      const d = document.createElement('div')
      d.className = 'maplbl sea'
      d.textContent = this.opts.seaLabel(s.key)
      return new ml.Marker({ element: d, rotation: s.rot, rotationAlignment: 'viewport' }).setLngLat(s.c).addTo(this.map)
    })
    // Follow the theme without reloading: colours come from the CSS variables.
    this.mo = new MutationObserver(() => this.applyTheme())
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    this.ro = new ResizeObserver(() => { this.map.resize(); this.placeLabels() })
    this.ro.observe(this.el)
    this.map.on('moveend', () => { this.placeLabels(); this.el.dataset.zoom = this.map.getZoom().toFixed(2) })
    if (this.pending !== undefined) this.show(this.pending)
  }

  /**
   * Streets and buildings for the areas that have a detailed archive (see TILE_DETAIL_AREAS), drawn in the map's own
   * palette (coast colour, thin lines) from zoom 12 so a site such as the Kaaba shows its surroundings, not an empty plane.
   */
  private detailLayers(): StyleSpecification['layers'] {
    const coast = this.css('--map-coast') || '#B7A687'
    const out: StyleSpecification['layers'] = []
    for (const a of TILE_DETAIL_AREAS) {
      const source = `detail-${a.id}`
      const road = (id: string, kinds: string[], w: [number, number], minzoom: number) => ({
        id: `${source}-${id}`, type: 'line' as const, source, 'source-layer': 'roads', minzoom,
        filter: ['in', ['get', 'kind'], ['literal', kinds]] as never,
        layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
        paint: { 'line-color': coast, 'line-opacity': 0.75, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, w[0], 18, w[1]] as never },
      })
      out.push(
        { id: `${source}-buildings`, type: 'fill', source, 'source-layer': 'buildings', minzoom: 14, paint: { 'fill-color': coast, 'fill-opacity': 0.28, 'fill-outline-color': coast } },
        road('minor', ['minor_road', 'other'], [0.4, 3], 14),
        road('medium', ['medium_road'], [0.6, 5], 12),
        road('major', ['major_road', 'highway'], [0.9, 8], 12),
      )
    }
    return out
  }

  private padding() {
    const w = this.el.clientWidth || 360
    const h = this.el.clientHeight || 300
    const pad = Math.max(28, Math.min(w, h) * 0.1)
    // top clears the view toggle, bottom clears the route legend
    return { top: 68, bottom: 52, left: pad, right: pad }
  }

  private applyTheme() {
    if (!this.ready) return
    const set = (id: string, prop: string, v: string) => { if (v) this.map.setPaintProperty(id, prop as never, v as never) }
    set('sea', 'background-color', this.css('--map-sea'))
    set('earth', 'fill-color', this.css('--map-land'))
    set('lakes', 'fill-color', this.css('--map-sea'))
    set('coast', 'line-color', this.css('--map-coast'))
    for (const a of TILE_DETAIL_AREAS) {
      const src = `detail-${a.id}`
      const c = this.css('--map-coast')
      set(`${src}-buildings`, 'fill-color', c); set(`${src}-buildings`, 'fill-outline-color', c)
      for (const r of ['minor', 'medium', 'major']) set(`${src}-${r}`, 'line-color', c)
    }
    set('grid', 'line-color', this.css('--map-grid'))
    set('route-base', 'line-color', this.css('--map-route'))
    set('route-main', 'line-color', this.css('--map-route'))
  }

  show(data: MapData | null) {
    if (!this.ready) { this.pending = data; return }
    this.pending = undefined
    this.shown = data
    cancelAnimationFrame(this.anim)
    clearTimeout(this.timer)
    this.clearRoute()
    this.markers.forEach((m) => m.remove())
    this.markers = []
    this.el.setAttribute('role', 'img')
    this.el.setAttribute('aria-label', this.opts.ariaLabel(data?.label ?? ''))
    if (!data) return
    const ml = this.ml
    // non-highlighted first so the highlighted marker sits on top
    const order = [...data.markers.filter((m) => !m.highlight), ...data.markers.filter((m) => m.highlight)]
    this.markers = order.map((m) => {
      const root = document.createElement('div')
      root.className = `mapmk${m.highlight ? ' hl' : ''}${m.highlight ? '' : m.role === 'related' ? ' rel' : ''}`
      root.dataset.role = m.role
      const dot = document.createElement('i')
      const label = document.createElement('span')
      label.className = `maplbl${m.highlight ? ' hl' : ''}`
      label.textContent = m.name
      label.style.position = 'absolute'
      root.appendChild(dot)
      root.appendChild(label)
      return new ml.Marker({ element: root, anchor: 'center' }).setLngLat([m.lng, m.lat]).addTo(this.map)
    })
    const reduced = this.reduced
    const animate = !reduced
    const duration = animate ? 1700 : 0
    const draw = () => { clearTimeout(this.timer); this.placeLabels(); this.drawRoute(data, animate) }
    this.map.once('moveend', draw)
    this.timer = setTimeout(draw, duration + 400) // moveend can be skipped when the camera does not move
    if (data.focus) {
      // One place: fly to it at its type's zoom (region 6, city 12, site 17; capped where tiles are coarse).
      const f = data.focus
      if (animate) this.map.flyTo({ center: [f.lng, f.lat], zoom: f.zoom, padding: this.padding(), duration, essential: false, easing: ease })
      else this.map.jumpTo({ center: [f.lng, f.lat], zoom: f.zoom, padding: this.padding() })
    } else {
      // Several places and/or a route: fit them all, never closer than the primary place's zoom.
      this.map.fitBounds(boundsFor(data) as LngLatBoundsLike, { padding: this.padding(), duration, maxZoom: data.maxZoom ?? MAX_ZOOM, easing: ease })
    }
    this.first = false
    this.placeLabels()
  }

  private clearRoute() {
    const empty = { type: 'FeatureCollection', features: [] } as FeatureCollection
    ;(this.map.getSource('routeBase') as GeoJSONSource | undefined)?.setData(empty)
    ;(this.map.getSource('routeMain') as GeoJSONSource | undefined)?.setData(empty)
    this.map.setPaintProperty('route-base', 'line-opacity', 0)
  }

  private drawRoute(data: MapData, animate: boolean) {
    const r = data.route
    if (!r || r.coordinates.length < 2) return
    const pts = smooth(r.coordinates as LL[])
    const feat = (c: LL[]): FeatureCollection => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }] })
    const base = this.map.getSource('routeBase') as GeoJSONSource
    const main = this.map.getSource('routeMain') as GeoJSONSource
    // The night journey (Isra) is not a physical road: dotted, as in the design.
    const dotted = r.slug === 'isra'
    this.map.setPaintProperty('route-main', 'line-dasharray', dotted ? [0.01, 3] : [1, 0])
    base.setData(feat(pts))
    this.map.setPaintProperty('route-base', 'line-opacity-transition', { duration: animate ? 1000 : 0, delay: 0 })
    this.map.setPaintProperty('route-base', 'line-opacity', 0.16)
    if (!animate || dotted) { main.setData(feat(pts)); return }
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
    const total = cum[cum.length - 1]!
    const t0 = performance.now()
    const D = 2800
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / D)
      const L = total * ease(t)
      let i = cum.findIndex((c) => c >= L)
      if (i < 0) i = pts.length - 1
      const part = pts.slice(0, i)
      if (i > 0) {
        const f = (L - cum[i - 1]!) / ((cum[i]! - cum[i - 1]!) || 1)
        part.push([pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * f, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * f])
      }
      if (part.length > 1) main.setData(feat(part))
      if (t < 1) this.anim = requestAnimationFrame(step)
    }
    this.anim = requestAnimationFrame(step)
  }

  /** Put each label to the right/left/above/below its dot, whichever is free and inside the map. */
  private placeLabels() {
    if (!this.ready || !this.shown) return
    const W = this.el.clientWidth, H = this.el.clientHeight
    const taken: { x: number; y: number; w: number; h: number }[] = []
    const overlaps = (r: { x: number; y: number; w: number; h: number }) => taken.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y)
    const ordered = [...this.markers].reverse() // highlighted marker was added last → placed first
    for (const mk of ordered) {
      const root = mk.getElement()
      const label = root.querySelector<HTMLElement>('.maplbl')
      if (!label) continue
      const p = this.map.project(mk.getLngLat())
      const w = label.offsetWidth + 2, h = label.offsetHeight + 2
      const gap = 11
      const cands: [number, number, number, number][] = [
        [gap, -h / 2, p.x + gap, p.y - h / 2], // right
        [-gap - w, -h / 2, p.x - gap - w, p.y - h / 2], // left
        [-w / 2, -gap - h, p.x - w / 2, p.y - gap - h], // above
        [-w / 2, gap, p.x - w / 2, p.y + gap], // below
      ]
      const fit = cands.find(([, , x, y]) => x >= 4 && x + w <= W - 4 && y >= 56 && y + h <= H - 4 && !overlaps({ x, y, w, h })) ?? cands[0]!
      label.style.left = `${fit[0]}px`
      label.style.top = `${fit[1]}px`
      taken.push({ x: fit[2], y: fit[3], w, h })
    }
  }

  destroy() {
    this.dead = true
    cancelAnimationFrame(this.anim)
    clearTimeout(this.timer)
    this.mo?.disconnect()
    this.ro?.disconnect()
    if (this.ready) this.map.remove()
  }
}

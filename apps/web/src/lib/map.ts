'use client'
/**
 * MapLibre map for the event page: Protomaps PMTiles (self-hosted on R2) styled with the design's palette.
 * Behaviour from design/seerah-map.js: fly to the event, pulsing highlighted marker, approximate route drawn
 * progressively, sea labels, 2° graticule, theme switch, reduced motion.
 * Labels are HTML markers (not map symbols) so Bangla text uses the page fonts and needs no glyph server.
 */
import type { Map as MLMap, Marker, LngLatBoundsLike, GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import Supercluster from 'supercluster'
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

export type MapMode = '2d' | '3d'
export interface MapView { bearing: number; pitch: number; zoom: number; atMin: boolean; atMax: boolean }
export interface OtherPlace { slug: string; name: string; lng: number; lat: number; verified: boolean; type: string }
export const PITCH_3D = 55
const MAX_MAP_ZOOM = 18

export interface MapOptions {
  tilesUrl: string
  terrainUrl: string
  /** Shown in the attribution control while the terrain is on. */
  terrainAttribution: string
  seaLabel: (key: string) => string
  ariaLabel: (places: string) => string
  clusterLabel: (n: number) => string
  onView?: (v: MapView) => void
  /** A secondary ("other places") marker was activated. */
  onPick?: (slug: string) => void
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
  private mode: MapMode = '2d'
  private others: OtherPlace[] | null = null
  private cluster?: Supercluster<{ slug: string }>
  private otherMarkers = new Map<string, Marker>()
  private followRaf = 0
  private followTimer: ReturnType<typeof setTimeout> | undefined
  private viewRaf = 0
  private otherRaf = 0
  private onUserInput = () => this.stopFollow()

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
        // Elevation (Mapterhorn / Copernicus GLO-30 terrarium tiles, self-hosted). Two sources: one for the terrain mesh, one for the
        // hillshade, as MapLibre recommends for render quality. Both stay idle until the 3D mode is switched on.
        terrain: { type: 'raster-dem', url: `pmtiles://${this.opts.terrainUrl}`, encoding: 'terrarium', tileSize: 512 },
        'hillshade-dem': { type: 'raster-dem', url: `pmtiles://${this.opts.terrainUrl}`, encoding: 'terrarium', tileSize: 512, attribution: this.opts.terrainAttribution },
        grid: { type: 'geojson', data: graticule() },
        routeBase: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        routeMain: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'sea', type: 'background', paint: { 'background-color': this.css('--map-sea') || '#DDE3DA' } },
        { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: { 'fill-color': this.css('--map-land') || '#F0E6D2' } },
        { id: 'lakes', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': this.css('--map-sea') || '#DDE3DA' } },
        { id: 'hills', type: 'hillshade', source: 'hillshade-dem', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': this.css('--map-coast') || '#B7A687', 'hillshade-highlight-color': this.css('--map-halo') || '#F0E6D2', 'hillshade-accent-color': this.css('--map-coast') || '#B7A687', 'hillshade-illumination-direction': 315 } },
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
      // 2D is flat: no rotate/tilt gestures. The 3D mode switches them on (applyMode).
      dragRotate: false,
      pitchWithRotate: true,
      maxPitch: 75,
      maxZoom: MAX_MAP_ZOOM,
      renderWorldCopies: false,
      fadeDuration: 0,
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.touchPitch.disable()
    this.map.keyboard.disableRotation()
    this.map.addControl(new ml.AttributionControl({ compact: this.el.clientWidth < 640 }) /* collapsed behind the (i) button on narrow maps, spelled out when there is room */, 'bottom-right')
    // MapLibre opens a compact attribution at first; keep it closed behind the (i) button on narrow maps (still one tap away).
    const closeAttrib = () => this.el.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact')?.classList.remove('maplibregl-compact-show')
    requestAnimationFrame(closeAttrib)
    this.map.once('idle', closeAttrib)
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
    this.map.on('moveend', () => { this.placeLabels(); this.renderOthersSoon(); this.publish() })
    this.map.on('move', () => { if (!this.viewRaf) this.viewRaf = requestAnimationFrame(() => { this.viewRaf = 0; this.publish() }) })
    // Any user input on the map (press, wheel, touch, key) ends an automatic camera flight. Listening to the DOM rather than to
    // MapLibre's movestart: the flight itself moves the camera every frame and would swallow the gesture's own event.
    for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const) this.el.addEventListener(ev, this.onUserInput, { capture: true, passive: true })
    this.publish()
    if (this.mode === '3d') this.applyMode(false)
    if (this.pending !== undefined) this.show(this.pending)
    if (this.others) this.renderOthers()
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
    set('hills', 'hillshade-shadow-color', this.css('--map-coast'))
    set('hills', 'hillshade-accent-color', this.css('--map-coast'))
    set('hills', 'hillshade-highlight-color', this.css('--map-halo'))
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
    const animate = !this.reduced
    const draw = () => { clearTimeout(this.timer); this.placeLabels(); this.drawRoute(data, animate); this.followSoon(data) }
    this.map.once('moveend', draw)
    this.timer = setTimeout(draw, (animate ? 1700 : 0) + 400) // moveend can be skipped when the camera does not move
    this.stopFollow()
    this.camera(data, animate)
    this.first = false
    this.renderOthers() // the places on the page now are not "other" places
    this.placeLabels()
  }

  /** Aim the camera at what the event shows: one place → fly there at its zoom; several/route → fit them all. Pitch follows the mode. */
  private camera(data: MapData | null, animate: boolean) {
    const pitch = this.mode === '3d' ? PITCH_3D : 0
    const duration = animate ? 1700 : 0
    if (!data) { this.map.fitBounds(PENINSULA as LngLatBoundsLike, { padding: this.padding(), duration, pitch, bearing: 0, easing: ease }); return }
    if (data.focus) {
      // One place: fly to it at its type's zoom (region 6, city 12, site 17; capped where tiles are coarse).
      const f = data.focus
      const to = { center: [f.lng, f.lat] as LL, zoom: f.zoom, padding: this.padding(), pitch, bearing: 0 }
      if (animate) this.map.flyTo({ ...to, duration, essential: false, easing: ease })
      else this.map.jumpTo(to)
    } else {
      // Several places and/or a route: fit them all, never closer than the primary place's zoom.
      this.map.fitBounds(boundsFor(data) as LngLatBoundsLike, { padding: this.padding(), duration, maxZoom: data.maxZoom ?? MAX_ZOOM, pitch, bearing: 0, easing: ease })
    }
  }

  // ───────────── 2D / 3D ─────────────
  get currentMode(): MapMode { return this.mode }

  setMode(mode: MapMode) {
    if (mode === this.mode) return
    this.mode = mode
    if (this.ready) this.applyMode(true)
  }

  private applyMode(animate: boolean) {
    const m = this.map
    this.stopFollow()
    const on = this.mode === '3d'
    m.setLayoutProperty('hills', 'visibility', on ? 'visible' : 'none')
    m.setTerrain(on ? { source: 'terrain', exaggeration: 1.35 } : null)
    if (on) { m.dragRotate.enable(); m.touchPitch.enable(); m.keyboard.enableRotation(); m.touchZoomRotate.enableRotation() }
    else { m.dragRotate.disable(); m.touchPitch.disable(); m.keyboard.disableRotation(); m.touchZoomRotate.disableRotation() }
    const doAnimate = animate && !this.reduced
    this.camera(this.shown, doAnimate)
    if (on && this.shown) this.followSoon(this.shown, doAnimate ? 2200 : 0)
    this.publish()
  }

  // ───────────── controls ─────────────
  zoomBy(delta: number) {
    this.stopFollow()
    this.map.zoomTo(this.map.getZoom() + delta, { duration: this.reduced ? 0 : 250 })
  }
  /** Back to the event's place(s), flat or tilted according to the mode. */
  reset() {
    this.stopFollow()
    this.camera(this.shown, !this.reduced)
  }
  /** North up and the mode's default tilt (the compass button in 3D). */
  resetNorth() {
    this.stopFollow()
    this.map.easeTo({ bearing: 0, pitch: this.mode === '3d' ? PITCH_3D : 0, duration: this.reduced ? 0 : 500 })
  }

  private publish() {
    if (!this.ready) return
    const z = this.map.getZoom()
    this.el.dataset.zoom = z.toFixed(2)
    this.el.dataset.mode = this.mode
    this.el.dataset.pitch = this.map.getPitch().toFixed(0)
    this.el.dataset.bearing = this.map.getBearing().toFixed(0)
    this.el.dataset.terrain = this.map.getTerrain() ? 'on' : 'off'
    this.el.dataset.following = this.followRaf ? 'yes' : 'no'
    this.opts.onView?.({ bearing: this.map.getBearing(), pitch: this.map.getPitch(), zoom: z, atMin: z <= this.map.getMinZoom() + 0.01, atMax: z >= this.map.getMaxZoom() - 0.01 })
  }

  // ───────────── 3D: a slow flight along the event's route ─────────────
  private followSoon(data: MapData, delay = 3200) {
    if (this.mode !== '3d' || !data.route || this.reduced) return
    clearTimeout(this.followTimer)
    this.followTimer = setTimeout(() => this.startFollow(data), delay)
  }

  stopFollow() {
    clearTimeout(this.followTimer)
    if (this.followRaf) { cancelAnimationFrame(this.followRaf); this.followRaf = 0; this.publish() }
  }

  private startFollow(data: MapData) {
    const r = data.route
    if (!r || this.mode !== '3d' || this.reduced || this.shown !== data) return
    const pts = smooth(r.coordinates as LL[], 12)
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
    const total = cum[cum.length - 1]!
    if (total <= 0) return
    const at = (L: number): LL => {
      let i = cum.findIndex((c) => c >= L)
      if (i <= 0) return pts[0]!
      const f = (L - cum[i - 1]!) / ((cum[i]! - cum[i - 1]!) || 1)
      return [pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * f, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * f]
    }
    const zoom = total > 3 ? 8 : total > 1 ? 9 : 10
    const D = Math.min(45_000, Math.max(20_000, total * 9_000)) // slow: 20–45 s for the whole route
    let bearing = this.map.getBearing()
    const t0 = performance.now()
    let frames = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / D)
      const L = total * ease(t)
      const here = at(L), ahead = at(Math.min(total, L + total * 0.05 + 1e-6))
      const target = (Math.atan2(ahead[0] - here[0], ahead[1] - here[1]) * 180) / Math.PI
      let d = ((target - bearing + 540) % 360) - 180 // shortest turn
      bearing += d * 0.04
      this.map.jumpTo({ center: here, bearing, pitch: PITCH_3D, zoom })
      if (++frames % 12 === 0) this.placeLabels()
      if (t < 1) this.followRaf = requestAnimationFrame(step)
      else { this.followRaf = 0; this.placeLabels(); this.publish() }
    }
    this.followRaf = requestAnimationFrame(step)
    this.publish()
  }

  // ───────────── "other places" layer ─────────────
  /** Show (or with null hide) every other place as small secondary markers, clustered where they would touch. */
  setOthers(places: OtherPlace[] | null) {
    this.others = places
    this.renderOthers()
  }

  private renderOthersSoon() {
    if (!this.others || this.otherRaf) return
    this.otherRaf = requestAnimationFrame(() => { this.otherRaf = 0; this.renderOthers() })
  }

  private renderOthers() {
    if (!this.ready) return
    const drop = () => { this.otherMarkers.forEach((m) => m.remove()); this.otherMarkers.clear() }
    if (!this.others) { drop(); this.cluster = undefined; return }
    const here = new Set(this.shown?.markers.map((m) => m.slug) ?? [])
    const pts = this.others.filter((p) => !here.has(p.slug))
    this.cluster = new Supercluster<{ slug: string }>({ radius: 44, maxZoom: 15, minPoints: 2 })
    this.cluster.load(pts.map((p) => ({ type: 'Feature' as const, properties: { slug: p.slug }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })))
    const b = this.map.getBounds()
    const padLng = (b.getEast() - b.getWest()) * 0.25, padLat = (b.getNorth() - b.getSouth()) * 0.25
    const items = this.cluster.getClusters([Math.max(-180, b.getWest() - padLng), Math.max(-85, b.getSouth() - padLat), Math.min(180, b.getEast() + padLng), Math.min(85, b.getNorth() + padLat)], Math.max(0, Math.min(16, Math.round(this.map.getZoom()))))
    const bySlug = new Map(pts.map((p) => [p.slug, p]))
    const want = new Set<string>()
    const ml = this.ml
    for (const it of items) {
      const [lng, lat] = it.geometry.coordinates as [number, number]
      const props = it.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; slug?: string }
      const key = props.cluster ? `c${props.cluster_id}:${props.point_count}` : `p${props.slug}`
      want.add(key)
      if (this.otherMarkers.has(key)) continue
      const root = document.createElement('div')
      const hit = document.createElement('button')
      hit.type = 'button'
      hit.className = 'hit'
      if (props.cluster) {
        root.className = 'mapmk cl'
        hit.textContent = String(props.point_count)
        hit.setAttribute('aria-label', this.opts.clusterLabel(props.point_count ?? 0))
        const id = props.cluster_id!
        hit.addEventListener('click', () => {
          const z = Math.min(this.cluster?.getClusterExpansionZoom(id) ?? 12, 16)
          this.map.easeTo({ center: [lng, lat], zoom: z + 0.3, duration: this.reduced ? 0 : 500 })
        })
        root.appendChild(hit)
      } else {
        const p = bySlug.get(props.slug!)!
        root.className = 'mapmk oth'
        hit.setAttribute('aria-label', p.name)
        hit.addEventListener('click', () => this.opts.onPick?.(p.slug))
        const dot = document.createElement('i')
        const label = document.createElement('span')
        label.className = 'maplbl oth'
        label.textContent = p.name
        label.style.position = 'absolute'
        root.appendChild(hit); root.appendChild(dot); root.appendChild(label)
      }
      this.otherMarkers.set(key, new ml.Marker({ element: root, anchor: 'center' }).setLngLat([lng, lat]).addTo(this.map))
    }
    for (const [key, m] of this.otherMarkers) if (!want.has(key)) { m.remove(); this.otherMarkers.delete(key) }
    this.el.dataset.others = String(this.otherMarkers.size)
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
    if (!this.ready) return
    const W = this.el.clientWidth, H = this.el.clientHeight
    const taken: { x: number; y: number; w: number; h: number }[] = []
    const overlaps = (r: { x: number; y: number; w: number; h: number }) => taken.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y)
    // Priority: the event's own places (highlighted first), then cluster bubbles, then other places (label hidden when it has no free spot).
    const ordered: { mk: Marker; kind: 'event' | 'cluster' | 'other' }[] = [
      ...[...this.markers].reverse().map((mk) => ({ mk, kind: 'event' as const })),
      ...[...this.otherMarkers.values()].filter((m) => m.getElement().classList.contains('cl')).map((mk) => ({ mk, kind: 'cluster' as const })),
      ...[...this.otherMarkers.values()].filter((m) => m.getElement().classList.contains('oth')).map((mk) => ({ mk, kind: 'other' as const })),
    ]
    for (const { mk, kind } of ordered) {
      const root = mk.getElement()
      const p = this.map.project(mk.getLngLat())
      if (kind === 'cluster') { taken.push({ x: p.x - 16, y: p.y - 16, w: 32, h: 32 }); continue }
      const label = root.querySelector<HTMLElement>('.maplbl')
      if (!label) continue
      const w = label.offsetWidth + 2, h = label.offsetHeight + 2
      const gap = kind === 'other' ? 8 : 11
      const cands: [number, number, number, number][] = [
        [gap, -h / 2, p.x + gap, p.y - h / 2], // right
        [-gap - w, -h / 2, p.x - gap - w, p.y - h / 2], // left
        [-w / 2, -gap - h, p.x - w / 2, p.y - gap - h], // above
        [-w / 2, gap, p.x - w / 2, p.y + gap], // below
      ]
      const free = cands.find(([, , x, y]) => x >= 4 && x + w <= W - 4 && y >= 56 && y + h <= H - 4 && !overlaps({ x, y, w, h }))
      if (kind === 'other' && !free) { label.style.visibility = 'hidden'; taken.push({ x: p.x - 5, y: p.y - 5, w: 10, h: 10 }); continue }
      label.style.visibility = ''
      const fit = free ?? cands[0]!
      label.style.left = `${fit[0]}px`
      label.style.top = `${fit[1]}px`
      taken.push({ x: fit[2], y: fit[3], w, h })
      taken.push({ x: p.x - 5, y: p.y - 5, w: 10, h: 10 })
    }
  }

  destroy() {
    this.dead = true
    this.stopFollow()
    for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const) this.el.removeEventListener(ev, this.onUserInput, { capture: true })
    cancelAnimationFrame(this.viewRaf)
    cancelAnimationFrame(this.otherRaf)
    cancelAnimationFrame(this.anim)
    clearTimeout(this.timer)
    this.mo?.disconnect()
    this.ro?.disconnect()
    if (this.ready) this.map.remove()
  }
}

'use client'
import 'maplibre-gl/dist/maplibre-gl.css'
import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFmt } from './Providers'
import { CompassIcon, Icon } from './icons'
import type { MapData, PlaceIndexItem } from '@/lib/content'
import type { MapMode, MapView, SeerahMap } from '@/lib/map'

interface Ctx { data: MapData | null; setData(d: MapData | null): void }
const MapCtx = createContext<Ctx>({ data: null, setData: () => {} })

/** Lives in a layout, so the map instance survives navigation between events and can fly from one to the next. */
export function MapStageProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<MapData | null>(null)
  const v = useMemo(() => ({ data, setData }), [data])
  return <MapCtx.Provider value={v}>{children}</MapCtx.Provider>
}

/** Rendered by each event page: tells the persistent map what to show. */
export function MapSync({ data }: { data: MapData }) {
  const { setData } = useContext(MapCtx)
  const key = `${data.eventId}|${data.markers.map((m) => `${m.slug}:${m.role}`).join(',')}|${data.route?.slug ?? ''}|${data.focus?.zoom ?? ''}`
  useEffect(() => { setData(data) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

const MODE_KEY = 'seerah:map:mode'
const TERRAIN_ATTRIBUTION = '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a> · Copernicus DEM GLO-30 © DLR e.V., Airbus Defence and Space, provided under COPERNICUS by the EU and ESA'
const readMode = (): MapMode | null => { try { const v = localStorage.getItem(MODE_KEY); return v === '2d' || v === '3d' ? v : null } catch { return null } }
const saveMode = (m: MapMode) => { try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode: the choice lasts for this visit */ } }
/** Terrain needs WebGL2. (Memory/CPU are not probed: 3D is opt-in and remembered, never switched on for anyone.) */
const webgl2 = () => { try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false } }

export function MapStage() {
  const f = useFmt()
  const { data } = useContext(MapCtx)
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<SeerahMap | null>(null)
  const [failed, setFailed] = useState(false)
  const [mode, setModeState] = useState<MapMode>('2d')
  const [can3d, setCan3d] = useState(true)
  const [view, setView] = useState<MapView>({ bearing: 0, pitch: 0, zoom: 0, atMin: false, atMax: false })
  const [othersOn, setOthersOn] = useState(false)
  const [others, setOthers] = useState<{ lang: string; places: PlaceIndexItem[] } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const fRef = useRef(f); fRef.current = f
  const dataRef = useRef(data); dataRef.current = data
  const modeRef = useRef(mode); modeRef.current = mode
  const othersRef = useRef<PlaceIndexItem[] | null>(null)
  othersRef.current = othersOn && others?.lang === f.lang ? others.places : null

  // remembered choice + capability, client only
  useEffect(() => {
    const ok = webgl2()
    setCan3d(ok)
    const m = readMode()
    if (ok && m === '3d') setModeState('3d')
  }, [])

  useEffect(() => {
    let off = false
    const el = box.current
    if (!el) return
    ;(async () => {
      try {
        const { SeerahMap } = await import('@/lib/map')
        if (off) return
        const m = new SeerahMap(el, {
          tilesUrl: `${location.origin}/tiles/arabia.pmtiles`,
          terrainUrl: `${location.origin}/tiles/terrain.pmtiles`,
          terrainAttribution: TERRAIN_ATTRIBUTION,
          seaLabel: (k) => fRef.current.t(k as 'map.sea.red'),
          ariaLabel: (places) => fRef.current.t('map.aria', { places }),
          clusterLabel: (n) => fRef.current.t('map.cluster', { n: fRef.current.n(n) }),
          onView: setView,
          onPick: (slug) => setPicked(slug),
        })
        map.current = m
        m.setMode(modeRef.current)
        await m.init()
        if (!off) {
          m.show(dataRef.current) // data may have arrived while the map library was still loading
          m.setOthers(othersRef.current ? othersRef.current.map(toOther) : null)
        }
      } catch (e) {
        console.warn('map unavailable', e)
        if (!off) setFailed(true)
      }
    })()
    return () => { off = true; map.current?.destroy(); map.current = null }
  }, [])

  useEffect(() => { map.current?.show(data) }, [data])
  useEffect(() => { map.current?.setMode(mode) }, [mode])
  useEffect(() => { map.current?.setOthers(othersRef.current ? othersRef.current.map(toOther) : null); if (!othersOn) setPicked(null) }, [othersOn, others, f.lang])

  // load the places index the first time "other places" is switched on (and again when the language changed)
  useEffect(() => {
    if (!othersOn || others?.lang === f.lang) return
    let off = false
    fetch(`/api/places?lang=${f.lang}`).then((r) => (r.ok ? (r.json() as Promise<{ places: PlaceIndexItem[] }>) : Promise.reject(r.status))).then((j) => { if (!off) setOthers({ lang: f.lang, places: j.places }) }).catch(() => { if (!off) setOthersOn(false) })
    return () => { off = true }
  }, [othersOn, others, f.lang])

  const choose = useCallback((m: MapMode) => { setModeState(m); saveMode(m) }, [])
  const place = picked && others ? others.places.find((p) => p.slug === picked) ?? null : null
  const is3d = mode === '3d'

  return (
    <div className="stage">
      <div ref={box} className="mapbox" />
      {failed ? <div className="mapfail">{f.t('map.failed')}</div> : null}

      <button type="button" className="mapchip" aria-pressed={othersOn} aria-label={f.t('map.othersAria')} onClick={() => setOthersOn((v) => !v)}>
        <Icon d="layers" size={18} sw={1.9} /><span>{f.t('map.others')}</span>
      </button>

      <div className="seg" role="group" aria-label={f.t('map.view')}>
        <button type="button" className={is3d ? 'off' : 'on'} aria-pressed={!is3d} aria-label={f.t('map.mode2d')} onClick={() => choose('2d')}>{f.t('map.label')}</button>
        <button type="button" className={is3d ? 'on' : 'off'} aria-pressed={is3d} aria-label={f.t('map.mode3d')} disabled={!can3d} title={can3d ? undefined : f.t('map.3dUnavailable')} onClick={() => choose('3d')}>{f.t('map.terrain')}</button>
      </div>

      <div className="mapctl" role="group" aria-label={f.t('map.controls')}>
        <button type="button" aria-label={f.t('map.zoomIn')} disabled={view.atMax} onClick={() => map.current?.zoomBy(1)}><Icon d="plus" size={20} sw={2} /></button>
        <button type="button" aria-label={f.t('map.zoomOut')} disabled={view.atMin} onClick={() => map.current?.zoomBy(-1)}><Icon d="minus" size={20} sw={2} /></button>
        <button type="button" aria-label={f.t('map.reset')} onClick={() => map.current?.reset()}><Icon d="target" size={20} sw={1.9} /></button>
      </div>
      {is3d ? <div className="mapctl start"><button type="button" className="compass" aria-label={f.t('map.compass')} onClick={() => map.current?.resetNorth()}><CompassIcon bearing={view.bearing} /></button></div> : null}

      {data?.route ? <div className="routelegend"><i />{data.route.name}</div> : null}
      {place ? <PlaceCard place={place} onClose={() => setPicked(null)} /> : null}
    </div>
  )
}

const toOther = (p: PlaceIndexItem) => ({ slug: p.slug, name: p.name, lng: p.lng, lat: p.lat, verified: p.verified, type: p.type })

/** A small card for a tapped place: name, type, "not yet verified", and its published events. */
function PlaceCard({ place, onClose }: { place: PlaceIndexItem; onClose: () => void }) {
  const f = useFmt()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const press = (e: Event) => { const t = e.target as Element; if (!ref.current?.contains(t) && !t.closest?.('.mapmk')) onClose() }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', press)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', press) }
  }, [onClose, place.slug])
  return (
    <div className="placecard" role="dialog" aria-label={place.name} tabIndex={-1} ref={ref}>
      <div className="ph">
        <div className="pt">
          <b>{place.name}</b>
          <span>{f.t(`place.type.${place.type}` as 'place.type.site')}{place.verified ? null : <em className="unv">{f.t('place.unverified')}</em>}</span>
        </div>
        <button type="button" className="px" aria-label={f.t('place.close')} onClick={onClose}><Icon d="close" size={20} sw={2} /></button>
      </div>
      <div className="pb">
        {place.events.length ? (
          <>
            <h4>{f.t('place.events')}</h4>
            <ul>{place.events.map((e) => <li key={e.slug}><Link href={`/${f.lang}/events/${e.slug}`} onClick={onClose}>{e.title}</Link></li>)}</ul>
          </>
        ) : <p>{f.t('place.noEvents')}</p>}
      </div>
    </div>
  )
}

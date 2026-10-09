'use client'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFmt } from './Providers'
import type { MapData } from '@/lib/content'
import type { SeerahMap } from '@/lib/map'

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

export function MapStage() {
  const f = useFmt()
  const { data } = useContext(MapCtx)
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<SeerahMap | null>(null)
  const [failed, setFailed] = useState(false)
  const fRef = useRef(f)
  fRef.current = f
  const dataRef = useRef(data)
  dataRef.current = data

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
          seaLabel: (k) => fRef.current.t(k as 'map.sea.red'),
          ariaLabel: (places) => fRef.current.t('map.aria', { places }),
        })
        map.current = m
        await m.init()
        if (!off) m.show(dataRef.current) // data may have arrived while the map library was still loading
      } catch (e) {
        console.warn('map unavailable', e)
        if (!off) setFailed(true)
      }
    })()
    return () => { off = true; map.current?.destroy(); map.current = null }
  }, [])

  useEffect(() => { map.current?.show(data) }, [data])

  return (
    <div className="stage">
      <div ref={box} className="mapbox" />
      {failed ? <div className="mapfail">{f.t('map.failed')}</div> : null}
      <div className="seg" role="group" aria-label={f.t('map.view')}>
        <span className="on">{f.t('map.label')}</span>
        <span className="off" aria-disabled="true" title={f.t('map.soonTitle')}>{f.t('map.terrain')}<em>{f.t('map.soon')}</em></span>
      </div>
      {data?.route ? <div className="routelegend"><i />{data.route.name}</div> : null}
    </div>
  )
}

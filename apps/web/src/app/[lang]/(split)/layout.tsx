import { MapStageProvider } from '@/components/MapStage'
import { TimelineList } from '@/components/TimelineList'
import { AsideHead } from '@/components/HomeParts'

export default function SplitLayout({ children }: { children: React.ReactNode }) {
  return (
    <MapStageProvider>
      <div className="split">
        <aside aria-label="timeline">
          <AsideHead />
          <TimelineList />
        </aside>
        <main>{children}</main>
      </div>
    </MapStageProvider>
  )
}

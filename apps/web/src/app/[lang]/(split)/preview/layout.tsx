import { MapStage } from '@/components/MapStage'

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="eventpane">
      <MapStage />
      {children}
    </div>
  )
}

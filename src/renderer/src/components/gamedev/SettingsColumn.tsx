import type { ReactNode } from 'react'
import { Settings } from 'lucide-react'

export default function SettingsColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel-scroll">
      <div className="section-head">
        <Settings size={14} className="text-muted" />
        <span className="label-caps">
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}

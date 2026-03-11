import { Card } from '../ui/index.ts'
import { Sparkles, Flame, Zap, Building2, Rocket, Bot } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT } from '../../i18n/index.tsx'

const DEMO_ICONS: ReactNode[] = [
  <Flame key="flame" className="w-4 h-4 text-amber-400" />,
  <Zap key="zap" className="w-4 h-4 text-ocean-400" />,
  <Building2 key="building" className="w-4 h-4 text-confidence-medium" />,
  <Rocket key="rocket" className="w-4 h-4 text-deep-300" />,
  <Bot key="bot" className="w-4 h-4 text-confidence-high" />,
]

interface DemoScenariosProps {
  onSelect: (title: string, text: string) => void
}

export default function DemoScenarios({ onSelect }: DemoScenariosProps) {
  const { t } = useT()

  return (
    <div className="mt-12">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-medium text-text-secondary">
          {t.demos.sectionTitle}
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {t.demos.items.map((demo, index) => (
          <Card
            key={demo.title}
            hover
            padding="sm"
            onClick={() => onSelect(demo.title, demo.text)}
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 shrink-0">{DEMO_ICONS[index]}</div>
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-text-primary mb-0.5 leading-snug">
                  {demo.title}
                </h3>
                <p className="text-xs text-ocean-400/80 mb-1.5">
                  {demo.tagline}
                </p>
                <p className="text-xs text-text-muted line-clamp-2">
                  {demo.text.slice(0, 100)}...
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

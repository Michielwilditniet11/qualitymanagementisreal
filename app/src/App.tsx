import { useUIStore } from './store/uiStore'
import { useDataStore } from './store/dataStore'
import UploadScreen from './features/upload/UploadScreen'
import WebScreen from './features/web/WebScreen'
import DiagnosticsScreen from './features/diagnostics/DiagnosticsScreen'
import CalendarScreen from './features/calendar/CalendarScreen'
import KraljicScreen from './features/kraljic/KraljicScreen'
import ReportsScreen from './features/reports/ReportsScreen'
import { T } from './ui'

const TABS = [
  { key: 'upload', label: 'UPLOAD', needsData: false },
  { key: 'web', label: 'WEB', needsData: true },
  { key: 'diagnostics', label: 'DIAGNOSTICS', needsData: true },
  { key: 'calendar', label: 'CALENDAR', needsData: true },
  { key: 'kraljic', label: 'KRALJIC', needsData: true },
  { key: 'reports', label: 'REPORTS', needsData: true },
] as const

export default function App() {
  const view = useUIStore(s => s.view)
  const setView = useUIStore(s => s.setView)
  const dataset = useDataStore(s => s.dataset)
  const hasData = dataset !== null

  const screens: Record<string, React.ReactNode> = {
    upload: <UploadScreen />,
    web: <WebScreen />,
    diagnostics: <DiagnosticsScreen />,
    calendar: <CalendarScreen />,
    kraljic: <KraljicScreen />,
    reports: <ReportsScreen />,
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: T.ground, color: T.text }}>
      <header className="flex items-stretch flex-shrink-0"
        style={{ background: T.ground, borderBottom: `1px solid ${T.hairline}` }}>
        <div className="flex items-center px-4" style={{ borderRight: `1px solid ${T.hairline}` }}>
          <span className="text-[13px] font-bold tracking-tight">
            PROCUREMENT<span style={{ color: T.cyan }}>WEB</span>
          </span>
        </div>

        <nav className="flex items-stretch">
          {TABS.map(tab => {
            const disabled = tab.needsData && !hasData
            const active = view === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => !disabled && setView(tab.key)}
                disabled={disabled}
                aria-current={active ? 'page' : undefined}
                className="px-3.5 text-[10px] tracking-[0.14em] transition-colors"
                style={{
                  fontFamily: T.mono,
                  color: disabled ? T.faint : active ? T.cyan : T.muted,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  borderBottom: `2px solid ${active ? T.cyan : 'transparent'}`,
                  background: active ? T.panel : 'transparent',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </nav>

        <div className="flex-1" />

        {/* Dataset badge — what is loaded, at a glance. */}
        {dataset && (
          <div className="flex items-center gap-2 px-4 text-[9px] tracking-wider"
            style={{ fontFamily: T.mono, color: T.muted, borderLeft: `1px solid ${T.hairline}` }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: T.green }} />
            <span style={{ color: T.dim }}>{dataset.sourceName}</span>
            <span>·</span>
            <span className="tabular-nums">{dataset.contracts.length} CONTRACTS</span>
            <span>·</span>
            <span className="tabular-nums">{dataset.importedAt.toISOString().slice(0, 10)}</span>
          </div>
        )}
      </header>
      <main className="flex-1 flex min-h-0">
        {screens[view]}
      </main>
    </div>
  )
}

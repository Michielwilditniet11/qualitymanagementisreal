import { useUIStore } from './store/uiStore'
import { useDataStore } from './store/dataStore'
import UploadScreen from './features/upload/UploadScreen'
import WebScreen from './features/web/WebScreen'
import DiagnosticsScreen from './features/diagnostics/DiagnosticsScreen'
import CalendarScreen from './features/calendar/CalendarScreen'
import KraljicScreen from './features/kraljic/KraljicScreen'
import ReportsScreen from './features/reports/ReportsScreen'

const TABS = [
  { key: 'upload', label: 'Upload', needsData: false },
  { key: 'web', label: 'Spider Web', needsData: true },
  { key: 'diagnostics', label: 'Diagnostics', needsData: true },
  { key: 'calendar', label: 'Calendar', needsData: true },
  { key: 'kraljic', label: 'Kraljic', needsData: true },
  { key: 'reports', label: 'Reports', needsData: true },
] as const

export default function App() {
  const view = useUIStore(s => s.view)
  const setView = useUIStore(s => s.setView)
  const hasData = useDataStore(s => s.dataset !== null)

  const screens: Record<string, React.ReactNode> = {
    upload: <UploadScreen />,
    web: <WebScreen />,
    diagnostics: <DiagnosticsScreen />,
    calendar: <CalendarScreen />,
    kraljic: <KraljicScreen />,
    reports: <ReportsScreen />,
  }

  return (
    <div className="h-screen flex flex-col bg-[#0f1420] text-[#e8edf7]">
      <header className="flex items-center gap-4 px-5 py-2.5 bg-[#171e2e] border-b border-[#2a3650]">
        <h1 className="text-base font-bold tracking-wide">
          Procurement<span className="text-[#4da3ff]">Web</span>
        </h1>
        <div className="flex-1" />
        <nav className="flex gap-1">
          {TABS.map(tab => {
            const disabled = tab.needsData && !hasData
            return (
              <button
                key={tab.key}
                onClick={() => !disabled && setView(tab.key)}
                disabled={disabled}
                className={`px-3 py-1.5 rounded-lg text-[13px] transition
                  ${view === tab.key ? 'bg-[#1d2639] text-white border border-[#2a3650]' : 'text-[#8fa0bd] border border-transparent hover:text-white'}
                  ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {tab.label}
              </button>
            )
          })}
        </nav>
      </header>
      <main className="flex-1 flex min-h-0">
        {screens[view]}
      </main>
    </div>
  )
}

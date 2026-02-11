import { useState, useEffect, useCallback } from 'react'
import StatusPanel from './components/StatusPanel'
import Controls from './components/Controls'
import LogViewer from './components/LogViewer'
import Presets from './components/Presets'
import Playground from './components/Playground'
import ModelSelector from './components/ModelSelector'
import GpuMetrics from './components/GpuMetrics'

export interface ServiceStatus {
  id: string
  name: string
  state: string
  health: string
  pid: number | null
  port: number | null
  depends_on: string[]
}

const tabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'playground', label: 'Playground' },
  { id: 'presets', label: 'Presets' },
] as const

type TabId = typeof tabs[number]['id']

export default function App() {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status')
      if (res.ok) {
        setServices(await res.json())
        setError(null)
      }
    } catch {
      setError('Backend unreachable')
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 10000)
    return () => clearInterval(id)
  }, [fetchStatus])

  const allRunning = services.length > 0 && services.every(s => s.health === 'running')
  const anyStarting = services.some(s => s.health === 'starting')

  return (
    <div className="h-screen flex flex-col text-slate-800 overflow-hidden">
      {/* Header */}
      <header className="bg-white/70 backdrop-blur-md border-b border-blue-100/60 shrink-0">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500
                            flex items-center justify-center shadow-sm animate-float">
              <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            </div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              MioTTS Cockpit
            </h1>
          </div>

          <nav className="flex bg-slate-100/80 rounded-xl p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        <div className="max-w-5xl w-full mx-auto px-5 flex-1 min-h-0 flex flex-col py-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-4 shrink-0">
              {error}
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div key="dashboard" className="tab-content flex-1 min-h-0 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center shrink-0 animate-fade-in-up">
                <Controls allRunning={allRunning} anyStarting={anyStarting} onRefresh={fetchStatus} />
                <ModelSelector
                  allStopped={services.length > 0 && services.every(s => s.health === 'stopped')}
                  onRefresh={fetchStatus}
                />
              </div>
              <div className="shrink-0">
                <StatusPanel services={services} onRefresh={fetchStatus} />
              </div>
              <div className="shrink-0">
                <GpuMetrics />
              </div>
              <div className="flex-1 min-h-0">
                <LogViewer services={services} />
              </div>
            </div>
          )}
          {activeTab === 'playground' && (
            <div key="playground" className="tab-content flex-1 min-h-0 overflow-auto">
              <Playground />
            </div>
          )}
          {activeTab === 'presets' && (
            <div key="presets" className="tab-content flex-1 min-h-0 overflow-auto">
              <Presets />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

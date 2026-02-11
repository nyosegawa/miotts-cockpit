import { useState } from 'react'
import type { ServiceStatus } from '../App'

const stateConfig: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  running: {
    dot: 'bg-emerald-400',
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    label: 'Running',
  },
  starting: {
    dot: 'bg-amber-400 animate-pulse',
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    label: 'Starting...',
  },
  stopped: {
    dot: 'bg-slate-300',
    bg: 'bg-slate-50',
    text: 'text-slate-500',
    label: 'Stopped',
  },
  unhealthy: {
    dot: 'bg-rose-400',
    bg: 'bg-rose-50',
    text: 'text-rose-600',
    label: 'Unhealthy',
  },
  error: {
    dot: 'bg-rose-400',
    bg: 'bg-rose-50',
    text: 'text-rose-600',
    label: 'Error',
  },
}

const defaultState = stateConfig.stopped

interface Props {
  services: ServiceStatus[]
  onRefresh: () => void
}

export default function StatusPanel({ services, onRefresh }: Props) {
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  if (services.length === 0) {
    return (
      <div className="text-slate-400 text-sm py-4">Loading services...</div>
    )
  }

  const handleAction = async (id: string, action: 'start' | 'stop') => {
    setLoading((prev) => ({ ...prev, [id]: true }))
    try {
      await fetch(`/api/services/${id}/${action}`, { method: 'POST' })
    } catch { /* ignore */ }
    setLoading((prev) => ({ ...prev, [id]: false }))
    onRefresh()
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 stagger-children">
      {services.map((svc) => {
        const isRunning = svc.health === 'running'
        const isStopped = svc.health === 'stopped'
        const isTransitioning = svc.health === 'starting' || loading[svc.id]
        const cfg = stateConfig[svc.health] || defaultState

        return (
          <div
            key={svc.id}
            className="bg-white rounded-2xl p-4 space-y-3
                       border border-blue-100/40
                       shadow-[var(--shadow-blue)]
                       hover:shadow-[var(--shadow-blue-lg)]
                       card-hover"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-700">{svc.name}</h3>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                <span className={`w-2 h-2 rounded-full status-dot ${cfg.dot}`} />
                {cfg.label}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-slate-400">
                {svc.pid && (
                  <span className="bg-slate-50 px-2 py-0.5 rounded-md font-mono">
                    PID {svc.pid}
                  </span>
                )}
                {svc.port && (
                  <span className="bg-slate-50 px-2 py-0.5 rounded-md font-mono">
                    :{svc.port}
                  </span>
                )}
                {svc.depends_on.length > 0 && (
                  <span className="text-slate-400">
                    dep: {svc.depends_on.join(', ')}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {isStopped && (
                  <button
                    onClick={() => handleAction(svc.id, 'start')}
                    disabled={isTransitioning}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium
                               bg-blue-50 text-blue-600 hover:bg-blue-100
                               disabled:opacity-40 transition-colors"
                  >
                    Start
                  </button>
                )}
                {(isRunning || svc.health === 'unhealthy' || svc.health === 'error') && (
                  <button
                    onClick={() => handleAction(svc.id, 'stop')}
                    disabled={isTransitioning}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium
                               bg-slate-100 text-slate-500 hover:bg-slate-200
                               disabled:opacity-40 transition-colors"
                  >
                    Stop
                  </button>
                )}
                {isTransitioning && (
                  <svg className="animate-spin h-4 w-4 text-blue-400" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

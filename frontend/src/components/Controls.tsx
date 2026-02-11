import { useState } from 'react'

interface Props {
  allRunning: boolean
  anyStarting: boolean
  onRefresh: () => void
}

export default function Controls({ allRunning, anyStarting, onRefresh }: Props) {
  const [loading, setLoading] = useState<'start' | 'stop' | null>(null)

  const handleStart = async () => {
    setLoading('start')
    try {
      await fetch('/api/start', { method: 'POST' })
    } catch { /* ignore */ }
    setLoading(null)
    onRefresh()
  }

  const handleStop = async () => {
    setLoading('stop')
    try {
      await fetch('/api/stop', { method: 'POST' })
    } catch { /* ignore */ }
    setLoading(null)
    onRefresh()
  }

  const starting = loading === 'start' || anyStarting

  return (
    <div className="flex gap-2.5">
      <button
        onClick={handleStart}
        disabled={allRunning || starting}
        className="btn-generate flex-1 sm:flex-none px-5 py-2.5 rounded-xl font-medium text-sm text-white
                   bg-gradient-to-r from-blue-500 to-indigo-500
                   hover:from-blue-600 hover:to-indigo-600
                   disabled:opacity-40 disabled:cursor-not-allowed
                   transition-all duration-200 active:scale-[0.97]
                   shadow-md shadow-blue-200/50"
      >
        {starting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Starting...
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
            Start All
          </span>
        )}
      </button>
      <button
        onClick={handleStop}
        disabled={!allRunning && !anyStarting || loading === 'stop'}
        className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl font-medium text-sm
                   bg-white border border-slate-200 text-slate-600
                   hover:bg-slate-50 hover:border-slate-300
                   disabled:opacity-40 disabled:cursor-not-allowed
                   transition-all duration-200 active:scale-[0.97]
                   shadow-sm"
      >
        {loading === 'stop' ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Stopping...
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
            </svg>
            Stop All
          </span>
        )}
      </button>
    </div>
  )
}

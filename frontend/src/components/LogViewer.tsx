import { useState, useEffect, useRef } from 'react'
import type { ServiceStatus } from '../App'

function convertTimestamps(text: string, serverOffsetMin: number): string {
  const clientOffsetMin = -new Date().getTimezoneOffset()
  const diffMin = clientOffsetMin - serverOffsetMin
  if (diffMin === 0) return text

  // YYYY-MM-DD HH:MM:SS
  let result = text.replace(
    /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/g,
    (_m, y, mo, d, h, mi, s) => {
      const dt = new Date(+y, +mo - 1, +d, +h, +mi, +s)
      dt.setMinutes(dt.getMinutes() + diffMin)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
    }
  )
  // MM-DD HH:MM:SS (vLLM format, but avoid matching inside longer patterns)
  result = result.replace(
    /(?<!\d[-/])(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?!\d)/g,
    (_m, mo, d, h, mi, s) => {
      const now = new Date()
      const dt = new Date(now.getFullYear(), +mo - 1, +d, +h, +mi, +s)
      dt.setMinutes(dt.getMinutes() + diffMin)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
    }
  )
  return result
}

export default function LogViewer({ services }: { services: ServiceStatus[] }) {
  const [activeService, setActiveService] = useState<string>(services[0]?.id || '')
  const [logs, setLogs] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const logRef = useRef<HTMLPreElement>(null)
  const utcOffsetRef = useRef<number | null>(null)

  useEffect(() => {
    if (services.length > 0 && !activeService) {
      setActiveService(services[0].id)
    }
  }, [services, activeService])

  useEffect(() => {
    if (!activeService) return
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/logs/${activeService}?lines=200`)
        if (res.ok) {
          const data = await res.json()
          utcOffsetRef.current = data.utc_offset_minutes ?? null
          const raw = data.logs || ''
          setLogs(
            utcOffsetRef.current !== null
              ? convertTimestamps(raw, utcOffsetRef.current)
              : raw
          )
        }
      } catch { /* ignore */ }
    }
    fetchLogs()
    const id = setInterval(fetchLogs, 5000)
    return () => clearInterval(id)
  }, [activeService])

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  return (
    <div className="bg-white rounded-2xl overflow-hidden border border-blue-100/40
                    shadow-[var(--shadow-blue)] animate-fade-in-up
                    h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 shrink-0">
        <div className="flex gap-1">
          {services.map((svc) => (
            <button
              key={svc.id}
              onClick={() => { setActiveService(svc.id); setLogs('') }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                activeService === svc.id
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              {svc.id}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded border-slate-300 text-blue-500 focus:ring-blue-200"
          />
          Auto-scroll
        </label>
      </div>
      <pre
        ref={logRef}
        className="p-4 text-xs leading-relaxed text-slate-500 overflow-auto
                   flex-1 min-h-0 font-mono whitespace-pre-wrap break-all
                   bg-gradient-to-b from-slate-50/50 to-white"
      >
        {logs || <span className="text-slate-300">No logs yet.</span>}
      </pre>
    </div>
  )
}

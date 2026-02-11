import { useState, useEffect } from 'react'

interface GpuInfo {
  name: string | null
  memory_used_mb: number | null
  memory_total_mb: number | null
  utilization_percent: number | null
}

export default function GpuMetrics() {
  const [gpu, setGpu] = useState<GpuInfo | null>(null)

  useEffect(() => {
    const fetchGpu = async () => {
      try {
        const res = await fetch('/api/gpu')
        if (res.ok) setGpu(await res.json())
      } catch { /* ignore */ }
    }
    fetchGpu()
    const id = setInterval(fetchGpu, 10000)
    return () => clearInterval(id)
  }, [])

  if (!gpu || !gpu.name) return null

  const memPct = gpu.memory_used_mb && gpu.memory_total_mb
    ? Math.round((gpu.memory_used_mb / gpu.memory_total_mb) * 100)
    : null

  const barColor = (pct: number) =>
    pct > 90 ? 'from-rose-400 to-red-500' :
    pct > 70 ? 'from-amber-400 to-orange-400' :
    'from-blue-400 to-indigo-400'

  return (
    <div className="bg-white rounded-2xl p-4 border border-blue-100/40
                    shadow-[var(--shadow-blue)] animate-fade-in-up card-hover">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-slate-700 flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
          </svg>
          GPU
        </h3>
        <span className="text-xs text-slate-400 font-medium">{gpu.name}</span>
      </div>

      <div className="space-y-3">
        {/* VRAM bar */}
        {memPct !== null && (
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-500 font-medium">VRAM</span>
              <span className="text-slate-400 tabular-nums">
                {gpu.memory_used_mb} / {gpu.memory_total_mb} MB ({memPct}%)
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden progress-bar">
              <div
                className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${barColor(memPct)}`}
                style={{ width: `${memPct}%` }}
              />
            </div>
          </div>
        )}

        {/* GPU utilization bar */}
        {gpu.utilization_percent !== null && (
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-500 font-medium">Utilization</span>
              <span className="text-slate-400 tabular-nums">{gpu.utilization_percent}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden progress-bar">
              <div
                className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${barColor(gpu.utilization_percent)}`}
                style={{ width: `${gpu.utilization_percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

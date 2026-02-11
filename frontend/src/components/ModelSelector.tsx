import { useState, useEffect } from 'react'

interface Model {
  id: string
  name: string
  gpu_memory_utilization: string
}

interface Props {
  allStopped: boolean
  onRefresh: () => void
}

export default function ModelSelector({ allStopped, onRefresh }: Props) {
  const [models, setModels] = useState<Model[]>([])
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/config')
        if (res.ok) {
          const data = await res.json()
          setModels(data.models || [])
          setCurrentModel(data.current_model)
          if (!selected && data.current_model) setSelected(data.current_model)
        }
      } catch { /* ignore */ }
    }
    fetchConfig()
  }, [])

  const handleChange = async () => {
    if (!selected || selected === currentModel) return
    setChanging(true)
    setError(null)
    try {
      const res = await fetch('/api/config/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: selected }),
      })
      if (res.ok) {
        setCurrentModel(selected)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || `Failed (${res.status})`)
      }
    } catch (e) {
      setError(String(e))
    }
    setChanging(false)
    onRefresh()
  }

  if (models.length === 0) return null

  const isDirty = selected !== currentModel

  return (
    <div className="flex items-center gap-2.5">
      <select
        value={selected}
        onChange={(e) => { setSelected(e.target.value); setError(null) }}
        disabled={changing}
        className="bg-white border border-slate-200 rounded-xl px-3 py-2.5
                   text-sm text-slate-700 focus:outline-none focus:border-blue-300
                   focus:ring-2 focus:ring-blue-100 shadow-sm
                   disabled:opacity-50 transition-all"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} (VRAM: {m.gpu_memory_utilization})
          </option>
        ))}
      </select>
      {isDirty && (
        <button
          onClick={handleChange}
          disabled={changing}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-white
                     bg-gradient-to-r from-violet-500 to-purple-500
                     hover:from-violet-600 hover:to-purple-600
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-all duration-200 shadow-md shadow-violet-200/50"
        >
          {changing ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Switching...
            </span>
          ) : (
            `Apply${allStopped ? '' : ' & Restart'}`
          )}
        </button>
      )}
      {error && (
        <span className="text-xs text-rose-500 font-medium">{error}</span>
      )}
    </div>
  )
}

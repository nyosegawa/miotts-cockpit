import { useState, useEffect, useRef, useCallback } from 'react'

interface Preset {
  id: string
  filename: string
  type: string
}

interface TTSTimings {
  total_sec: number
  llm_sec: number
  parse_sec: number
  codec_sec: number
  [key: string]: number | null
}

interface HistoryEntry {
  id: string
  text: string
  preset: string
  temperature: number
  topP: number
  tokenCount: number
  totalSec: number
  audioBase64: string
  timestamp: number
}

const HISTORY_KEY = 'miotts-cockpit-history'
const MAX_HISTORY = 20

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  } catch { return [] }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)))
}

function genId(): string {
  try { return crypto.randomUUID() } catch { /* non-secure context */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function base64ToBlobUrl(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}

export default function Playground() {
  const [text, setText] = useState('')
  const [refMode, setRefMode] = useState<'preset' | 'upload'>('preset')
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetId, setPresetId] = useState('')
  const [uploadedBase64, setUploadedBase64] = useState<string | null>(null)
  const [uploadedFilename, setUploadedFilename] = useState('')

  const [temperature, setTemperature] = useState(0.8)
  const [topP, setTopP] = useState(1.0)
  const [repPenalty, setRepPenalty] = useState(1.0)

  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{ audioUrl: string; tokenCount: number; timings: TTSTimings; normalizedText?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [playingId, setPlayingId] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement>(null)
  const historyAudioRef = useRef<HTMLAudioElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const fetchPresets = async () => {
      try {
        const res = await fetch('/api/presets')
        if (res.ok) {
          const data: Preset[] = await res.json()
          const embeddings = data.filter(p => p.type === 'embedding')
          setPresets(embeddings)
          if (embeddings.length > 0 && !presetId) {
            setPresetId(embeddings[0].id)
          }
        }
      } catch { /* ignore */ }
    }
    fetchPresets()
  }, [])

  const handleFileUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      setUploadedBase64(base64)
      setUploadedFilename(file.name)
    }
    reader.readAsDataURL(file)
  }

  const handleGenerate = async () => {
    if (!text.trim()) return
    if (refMode === 'preset' && !presetId) return
    if (refMode === 'upload' && !uploadedBase64) return

    setGenerating(true)
    setError(null)

    const body = {
      text: text.trim(),
      reference:
        refMode === 'preset'
          ? { type: 'preset', preset_id: presetId }
          : { type: 'base64', data: uploadedBase64 },
      llm: { temperature, top_p: topP, repetition_penalty: repPenalty },
      output: { format: 'base64' },
    }

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || `Error ${res.status}`)
      } else {
        if (result?.audioUrl) URL.revokeObjectURL(result.audioUrl)

        const url = base64ToBlobUrl(data.audio)
        setResult({
          audioUrl: url,
          tokenCount: data.token_count,
          timings: data.timings,
          normalizedText: data.normalized_text,
        })

        // Add to history
        const entry: HistoryEntry = {
          id: genId(),
          text: text.trim(),
          preset: refMode === 'preset' ? presetId : uploadedFilename,
          temperature,
          topP,
          tokenCount: data.token_count,
          totalSec: data.timings.total_sec,
          audioBase64: data.audio,
          timestamp: Date.now(),
        }
        const updated = [entry, ...history].slice(0, MAX_HISTORY)
        setHistory(updated)
        saveHistory(updated)
      }
    } catch (e) {
      setError(String(e))
    }
    setGenerating(false)
  }

  useEffect(() => {
    if (result?.audioUrl && audioRef.current) {
      audioRef.current.play().catch(() => {})
    }
  }, [result?.audioUrl])

  const playHistoryEntry = useCallback((entry: HistoryEntry) => {
    if (playingId === entry.id) {
      historyAudioRef.current?.pause()
      setPlayingId(null)
      return
    }
    const url = base64ToBlobUrl(entry.audioBase64)
    if (historyAudioRef.current) {
      historyAudioRef.current.src = url
      historyAudioRef.current.onended = () => setPlayingId(null)
      historyAudioRef.current.play().catch(() => {})
      setPlayingId(entry.id)
    }
  }, [playingId])

  const deleteHistoryEntry = useCallback((id: string) => {
    const updated = history.filter(e => e.id !== id)
    setHistory(updated)
    saveHistory(updated)
  }, [history])

  const clearHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem(HISTORY_KEY)
  }, [])

  const canGenerate =
    text.trim().length > 0 &&
    (refMode === 'preset' ? !!presetId : !!uploadedBase64) &&
    !generating

  return (
    <div className="space-y-6 stagger-children">
      {/* Text */}
      <div className="bg-white rounded-2xl p-5 border border-blue-100/40 shadow-[var(--shadow-blue)] card-hover">
        <label className="block text-sm font-semibold text-slate-700 mb-2">Text</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canGenerate) {
              e.preventDefault()
              handleGenerate()
            }
          }}
          placeholder="合成するテキストを入力..."
          maxLength={300}
          rows={3}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3
                     text-sm text-slate-700 resize-none
                     focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100
                     placeholder:text-slate-400 transition-all"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1.5">
          <span className="opacity-0 sm:opacity-100">Cmd+Enter to generate</span>
          <span className="tabular-nums">{text.length}/300</span>
        </div>
      </div>

      {/* Reference Audio */}
      <div className="bg-white rounded-2xl p-5 border border-blue-100/40 shadow-[var(--shadow-blue)] card-hover">
        <label className="block text-sm font-semibold text-slate-700 mb-3">Reference Audio</label>
        <div className="flex gap-4 mb-3">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer text-slate-600">
            <input type="radio" checked={refMode === 'preset'} onChange={() => setRefMode('preset')}
              className="text-blue-500 focus:ring-blue-200" />
            Preset
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer text-slate-600">
            <input type="radio" checked={refMode === 'upload'} onChange={() => setRefMode('upload')}
              className="text-blue-500 focus:ring-blue-200" />
            Upload
          </label>
        </div>
        {refMode === 'preset' ? (
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700
                       focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all"
          >
            {presets.length === 0 && <option value="">No presets available</option>}
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-600
                         hover:border-blue-300 hover:bg-blue-50/50 transition-all"
            >
              {uploadedFilename || 'Choose audio file...'}
            </button>
            {uploadedBase64 && (
              <span className="text-xs font-medium text-emerald-500 bg-emerald-50 px-2 py-1 rounded-full">
                Ready
              </span>
            )}
            <input ref={fileRef} type="file" accept=".wav,.flac,.ogg" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }} />
          </div>
        )}
      </div>

      {/* Parameters */}
      <div className="bg-white rounded-2xl p-5 border border-blue-100/40 shadow-[var(--shadow-blue)] card-hover">
        <label className="block text-sm font-semibold text-slate-700 mb-3">Parameters</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          <SliderParam label="Temperature" value={temperature} onChange={setTemperature} min={0} max={1.5} step={0.05} />
          <SliderParam label="Top-p" value={topP} onChange={setTopP} min={0.1} max={1.0} step={0.05} />
          <SliderParam label="Rep. Penalty" value={repPenalty} onChange={setRepPenalty} min={1.0} max={1.5} step={0.05} />
        </div>
      </div>

      {/* Generate */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="btn-generate w-full sm:w-auto px-8 py-3 rounded-xl font-medium text-sm text-white
                   bg-gradient-to-r from-blue-500 to-indigo-500
                   hover:from-blue-600 hover:to-indigo-600
                   disabled:opacity-40 disabled:cursor-not-allowed
                   transition-all duration-200 active:scale-[0.97]
                   shadow-lg shadow-blue-200/50"
      >
        {generating ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
            Generate
          </span>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {/* Latest Result */}
      {result && (
        <div className="bg-white rounded-2xl p-5 border border-blue-100/40 shadow-[var(--shadow-blue)] space-y-4 animate-scale-in">
          <audio ref={audioRef} src={result.audioUrl} controls className="w-full" />
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
            <Stat label="Tokens" value={String(result.tokenCount)} />
            <Stat label="Total" value={`${result.timings.total_sec?.toFixed(2)}s`} />
            <Stat label="LLM" value={`${result.timings.llm_sec?.toFixed(2)}s`} />
            <Stat label="Codec" value={`${result.timings.codec_sec?.toFixed(2)}s`} />
          </div>
          {result.normalizedText && result.normalizedText !== text.trim() && (
            <p className="text-xs text-slate-400">Normalized: {result.normalizedText}</p>
          )}
          <a href={result.audioUrl} download="tts_output.wav"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-500 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download WAV
          </a>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">History</h3>
            <button onClick={clearHistory}
              className="text-xs text-slate-400 hover:text-rose-500 transition-colors
                         px-2 py-1 rounded-lg hover:bg-rose-50">
              Clear all
            </button>
          </div>
          <audio ref={historyAudioRef} className="hidden" />
          <div className="space-y-2">
            {history.map((entry) => (
              <div key={entry.id}
                className="bg-white border border-blue-100/40 rounded-xl px-4 py-3
                           shadow-[var(--shadow-blue)]
                           flex items-center gap-3
                           hover:shadow-[var(--shadow-blue-lg)] card-hover">
                <button
                  onClick={() => playHistoryEntry(entry)}
                  className="btn-play shrink-0 w-8 h-8 rounded-full
                             bg-gradient-to-br from-blue-50 to-indigo-50
                             hover:from-blue-100 hover:to-indigo-100
                             flex items-center justify-center transition-all duration-200"
                >
                  {playingId === entry.id ? (
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-blue-500 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{entry.text}</p>
                  <div className="flex gap-3 text-xs text-slate-400 mt-0.5">
                    <span>{entry.preset}</span>
                    <span className="tabular-nums">T={entry.temperature}</span>
                    <span className="tabular-nums">{entry.tokenCount} tok</span>
                    <span className="tabular-nums">{entry.totalSec.toFixed(1)}s</span>
                    <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
                <button
                  onClick={() => deleteHistoryEntry(entry.id)}
                  className="shrink-0 text-xs text-slate-400 hover:text-rose-500 transition-colors
                             px-1.5 py-1 rounded-lg hover:bg-rose-50"
                >
                  Del
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SliderParam({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step: number
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-2">
        <span className="text-slate-500 font-medium">{label}</span>
        <span className="text-slate-400 tabular-nums bg-slate-50 px-2 py-0.5 rounded-md">{value.toFixed(2)}</span>
      </div>
      <input type="range" value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
        min={min} max={max} step={step} className="w-full h-1.5" />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-slate-400">{label}</span>{' '}
      <span className="text-slate-600 font-medium tabular-nums">{value}</span>
    </span>
  )
}

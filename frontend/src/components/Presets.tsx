import { useState, useEffect, useCallback, useRef } from 'react'

interface Preset {
  id: string
  filename: string
  size_bytes: number
  type: string
}

export default function Presets() {
  const [presets, setPresets] = useState<Preset[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch('/api/presets')
      if (res.ok) setPresets(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchPresets() }, [fetchPresets])

  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    for (const file of Array.from(files)) {
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await fetch('/api/presets/upload', { method: 'POST', body: form })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setUploadError(data.detail || `Upload failed (${res.status})`)
        }
      } catch (e) {
        setUploadError(String(e))
      }
    }
    setUploading(false)
    fetchPresets()
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete preset "${id}"?`)) return
    await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    fetchPresets()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-5 animate-fade-in-up">
      <h2 className="text-base font-semibold text-slate-700">Reference Audio Presets</h2>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer
                    transition-all duration-200 ${
                      dragOver
                        ? 'border-blue-400 bg-blue-50/50 scale-[1.01] upload-zone-active'
                        : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'
                    }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".wav,.flac,.ogg"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <p className="text-sm text-slate-500">
            {uploading
              ? 'Converting to embedding... (may take ~10s)'
              : 'Drop audio files here or click to upload'}
          </p>
          <p className="text-xs text-slate-400">.wav, .flac, .ogg</p>
        </div>
        {uploading && (
          <div className="mt-3 flex justify-center">
            <svg className="animate-spin h-5 w-5 text-blue-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>

      {uploadError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium">
          {uploadError}
        </div>
      )}

      {/* Preset list */}
      <div className="space-y-2 stagger-children">
        {presets.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">No presets found.</p>
        ) : (
          presets.map((p) => (
            <div
              key={p.id}
              className="bg-white border border-blue-100/40 rounded-xl px-4 py-3
                         shadow-[var(--shadow-blue)]
                         flex items-center justify-between
                         hover:shadow-[var(--shadow-blue-lg)] card-hover"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-slate-700">{p.id}</span>
                <span className="text-xs text-slate-400">{p.filename}</span>
                <span className="text-xs text-slate-400">{formatSize(p.size_bytes)}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  p.type === 'embedding'
                    ? 'bg-violet-50 text-violet-500'
                    : 'bg-slate-100 text-slate-500'
                }`}>
                  {p.type}
                </span>
              </div>
              <button
                onClick={() => handleDelete(p.id)}
                className="text-xs text-slate-400 hover:text-rose-500 transition-colors px-2 py-1 rounded-lg
                           hover:bg-rose-50"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

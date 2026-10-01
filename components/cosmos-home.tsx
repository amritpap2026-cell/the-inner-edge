'use client'

import { useState } from 'react'
import { Loader2, Plus, Search, Sparkles, X } from 'lucide-react'

type VideoPackage = {
  title: string
  description: string
  tags: string[]
  keywords: string[]
  hook: string
  thumbnailText: string
  fallback?: boolean
}

export function CosmosHome() {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [language, setLanguage] = useState('English')
  const [result, setResult] = useState<VideoPackage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function generateContent() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, language }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setResult(data)
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function close() {
    setOpen(false)
    setResult(null)
    setError('')
    setTopic('')
  }

  return (
    <main className="min-h-screen bg-[#e8f6f1] text-[#073b4c]">
      <header className="flex items-center justify-between border-b border-[#0d6b80]/15 bg-[#0d6b80] px-6 py-5 text-white sm:px-10">
        <a href="#top" className="text-sm font-semibold uppercase tracking-[0.22em]" aria-label="Cosmos home">Cosmos</a>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-full bg-[#79d2a5] px-5 py-2.5 text-sm font-semibold text-[#073b4c] transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <Plus size={16} aria-hidden="true" /> Create new videos
        </button>
      </header>

      <section id="top" className="flex min-h-[calc(100vh-77px)] items-center justify-center bg-[#e8f6f1] px-6 py-16 sm:px-10">
        <div className="h-40 w-full max-w-4xl rounded-3xl border border-[#79d2a5]/35 bg-[#f7fcfa]/50" aria-hidden="true" />
      </section>

      {open && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#073b4c]/55 px-4 py-8 sm:items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
        <section role="dialog" aria-modal="true" aria-labelledby="creator-title" className="w-full max-w-2xl rounded-3xl bg-[#f7fcfa] p-6 shadow-2xl sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#178b74]">Gemini studio</p><h1 id="creator-title" className="mt-2 text-2xl font-semibold text-[#073b4c]">Create a new space video</h1><p className="mt-2 text-sm text-[#38616b]">Find a mind-blowing topic and turn it into a YouTube-ready package.</p></div>
            <button type="button" onClick={close} aria-label="Close creator" className="rounded-full p-2 text-[#38616b] hover:bg-[#dff2eb]"><X size={20} /></button>
          </div>
          <div className="mt-7 grid gap-5">
            <label className="grid gap-2 text-sm font-semibold">Topic or question<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. Could life exist on Europa?" className="rounded-xl border border-[#b7d9ce] bg-white px-4 py-3 font-normal outline-none ring-[#178b74] placeholder:text-[#71939a] focus:ring-2" /></label>
            <div className="flex flex-wrap items-center gap-3"><span className="text-sm font-semibold">Language</span>{['English', 'हिन्दी', 'नेपाली'].map((option) => <button key={option} type="button" onClick={() => setLanguage(option)} className={`rounded-full px-4 py-2 text-sm transition ${language === option ? 'bg-[#0d6b80] text-white' : 'bg-[#dff2eb] text-[#073b4c] hover:bg-[#c6e9dc]'}`}>{option}</button>)}</div>
            <button type="button" onClick={generateContent} disabled={loading || topic.trim().length < 3} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#178b74] px-5 py-3 font-semibold text-white transition hover:bg-[#0d6b80] disabled:cursor-not-allowed disabled:opacity-50">{loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />} {loading ? 'Exploring the cosmos...' : 'Search this topic'}</button>
            {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          </div>
          {result && <div className="mt-8 grid gap-5 border-t border-[#c6e9dc] pt-6"><div className="flex items-center gap-2 text-sm font-semibold text-[#178b74]"><Sparkles size={17} /> YouTube package generated</div>{result.fallback && <div role="status" className="rounded-xl border border-[#b7d9ce] bg-[#eefaf5] px-4 py-3 text-sm text-[#38616b]"><span className="font-semibold text-[#073b4c]">Free fallback mode used.</span> Gemini was unavailable, so Cosmos created an instant starter package. You can edit it before publishing.</div>}<label className="grid gap-2 text-sm font-semibold">Title<input value={result.title} readOnly className="rounded-xl border border-[#b7d9ce] bg-white px-4 py-3 font-normal" /></label><label className="grid gap-2 text-sm font-semibold">Description<textarea value={result.description} readOnly rows={6} className="rounded-xl border border-[#b7d9ce] bg-white px-4 py-3 font-normal" /></label><label className="grid gap-2 text-sm font-semibold">Tags<input value={result.tags.join(', ')} readOnly className="rounded-xl border border-[#b7d9ce] bg-white px-4 py-3 font-normal" /></label><div className="grid gap-2 rounded-xl bg-[#dff2eb] p-4 text-sm"><span className="font-semibold">Opening hook</span><p>{result.hook}</p><span className="mt-2 font-semibold">Thumbnail text</span><p>{result.thumbnailText}</p></div></div>}
        </section>
      </div>}
    </main>
  )
}

export default CosmosHome

export function SearchHint() { return null }
export function SparkleHint() { return null }

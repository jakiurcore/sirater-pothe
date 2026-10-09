'use client'
import { useEffect, useRef, useState } from 'react'
import { useFmt } from './Providers'

const TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX = 10 * 1024 * 1024

/** Picks ONE file, previews it, asks for the "no people" confirmation, then PUTs it to the single-use URL on the MCP Worker. */
export function UploadForm({ token, endpoint }: { token: string; endpoint: string }) {
  const f = useFmt()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (x: File | null) => {
    setError(null)
    if (x && !TYPES.includes(x.type)) { setFile(null); setError(f.t('upload.wrongType')); return }
    if (x && x.size > MAX) { setFile(null); setError(f.t('upload.tooBig')); return }
    setFile(x)
  }

  const send = async () => {
    if (!file || !confirmed) return
    setState('sending'); setError(null)
    try {
      const res = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': file.type, 'X-People-Confirmed': 'no-people' }, body: file })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && j.ok) { setState('done'); return }
      setState('idle'); setError(res.status === 410 ? f.t('upload.invalid') : f.t('upload.failed', { msg: j.error ?? String(res.status) }))
    } catch {
      setState('idle'); setError(f.t('upload.network'))
    }
  }

  if (state === 'done') return (
    <div className="updone" role="status">
      <b>{f.t('upload.done')}</b>
      <p>{f.t('upload.doneHint')}</p>
    </div>
  )

  return (
    <form className="upform" onSubmit={(e) => { e.preventDefault(); void send() }} data-token-len={token.length}>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-label={f.t('upload.choose')} />
      <button type="button" className="btn ghostbtn" onClick={() => input.current?.click()}>{f.t('upload.choose')}</button>
      <p className="meta">{f.t('upload.formats')}</p>
      {preview ? (
        <figure className="uppreview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={f.t('upload.preview')} />
          <figcaption>{file?.name} · {(file!.size / 1024 / 1024).toFixed(1)} MB</figcaption>
        </figure>
      ) : null}
      <label className="upcheck">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{f.t('upload.noPeople')}</span>
      </label>
      {error ? <p className="uperr" role="alert">{error}</p> : null}
      <button type="submit" className="btn" disabled={!file || !confirmed || state === 'sending'}>{state === 'sending' ? f.t('upload.sending') : f.t('upload.confirm')}</button>
    </form>
  )
}

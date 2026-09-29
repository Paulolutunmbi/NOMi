import { useMemo, useState } from 'react'
import DOMPurify from 'dompurify'

// Renders an email's HTML the way a mail client does: sanitized, inside a
// sandboxed frame (no scripts, no access to NOMI), with remote images blocked
// until the user asks for them (they double as tracking pixels).
export default function EmailBody({ html, text }) {
  const [showImages, setShowImages] = useState(true)

  const { doc, hasRemoteImages } = useMemo(() => {
    if (!html) return { doc: '', hasRemoteImages: false }
    // WHOLE_DOCUMENT keeps the email's own <style> blocks (newsletters depend
    // on them for layout); scripts are still removed here and blocked again
    // by the iframe sandbox.
    const full = DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: true,
      ADD_TAGS: ['style'],
      FORBID_TAGS: ['form', 'input', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
      FORBID_ATTR: ['srcset'],
    })
    const parsed = new DOMParser().parseFromString(full, 'text/html')
    const emailStyles = [...parsed.head.querySelectorAll('style')].map((el) => el.outerHTML).join('')
    const clean = parsed.body.innerHTML
    const remote = /<img[^>]+src=["']https?:/i.test(clean)
    const body = showImages ? clean : clean.replace(/(<img[^>]+?)src=(["'])https?:[^"']*\2/gi, '$1data-blocked="1"')
    // Links open in a new tab; the frame's own styles are light so email
    // designs (which assume a white page) stay readable in dark mode.
    const withLinks = body.replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer nofollow" ')
    return {
      hasRemoteImages: remote,
      doc: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>
        html,body{margin:0;padding:12px;background:#fff;color:#1a1a1a;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;word-wrap:break-word}
        img{max-width:100%;height:auto}table{max-width:100%}a{color:#c2500f}
      </style>${emailStyles}</head><body>${withLinks}</body></html>`,
    }
  }, [html, showImages])

  if (!html) {
    // Plain-text mail: make links clickable, but show long tracking URLs
    // as just their site name so the text stays readable.
    const label = (url) => { try { return `[${new URL(url).hostname.replace(/^www\./, '')}]` } catch { return '[link]' } }
    const parts = String(text || '').replace(/\(\s*(https?:\/\/[^\s)]+)\s*\)/g, '$1').split(/(https?:\/\/[^\s<>"]+)/g)
    return (
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-soft">
        {parts.map((part, i) => /^https?:\/\//.test(part)
          ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="text-nomi-orange underline">{part.length > 60 ? label(part) : part}</a>
          : part)}
      </p>
    )
  }

  return (
    <div className="mt-2">
      {hasRemoteImages && !showImages && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-soft">
          <span>Images are hidden.</span>
          <button type="button" onClick={() => setShowImages(true)} className="shrink-0 font-medium text-nomi-orange hover:text-nomi-orange-dark">
            Show images
          </button>
        </div>
      )}
      <iframe
        title="Email content"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        srcDoc={doc}
        className="w-full overflow-hidden rounded-lg border border-line bg-white"
        style={{ height: 480 }}
        onLoad={(e) => {
          try {
            const h = e.currentTarget.contentDocument?.documentElement?.scrollHeight
            if (h) e.currentTarget.style.height = `${Math.min(Math.max(h + 8, 120), 1400)}px`
          } catch { /* keep default height */ }
        }}
      />
    </div>
  )
}

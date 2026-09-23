import { useRef } from 'react'

export default function Composer({ placeholder, disabled, onSend }) {
  const textareaRef = useRef(null)

  const submit = () => {
    const value = textareaRef.current?.value?.trim()
    if (!value || disabled) return
    onSend(value)
    textareaRef.current.value = ''
    textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const handleInput = (event) => {
    const el = event.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  return (
    <div
      className={`flex items-end gap-2 rounded-2xl border bg-surface p-2.5 shadow-card transition-colors focus-within:border-nomi-orange ${
        disabled ? 'border-line opacity-70' : 'border-line'
      }`}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        maxLength={4000}
        disabled={disabled}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        aria-label="Message NOMI"
        className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled}
        aria-label="Send"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-nomi-orange text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:bg-line-strong"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 12h15m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

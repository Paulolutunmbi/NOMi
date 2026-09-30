import { Link } from 'react-router-dom'
import NomiLogo from './NomiLogo'

export default function AuthCard({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-svh flex-col bg-surface-muted">
      <div className="p-5 sm:p-6">
        <Link to="/" className="inline-flex">
          <NomiLogo />
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-8">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">
            <h1 className="text-lg font-semibold text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-ink-faint">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <p className="mt-5 text-center text-sm text-ink-faint">{footer}</p>}
        </div>
      </div>
      <footer className="flex justify-center gap-5 px-4 pb-6 text-xs text-ink-faint">
        <Link to="/privacy" className="hover:text-ink">Privacy Policy</Link>
        <Link to="/terms" className="hover:text-ink">Terms of Service</Link>
      </footer>
    </div>
  )
}

export function AuthField({ label, ...inputProps }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-ink">{label}</span>
      <input
        {...inputProps}
        className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-nomi-orange focus:outline-none"
      />
    </label>
  )
}

export function AuthDivider({ label = 'or' }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  )
}

export function GoogleButton({ onClick, disabled, children = 'Continue with Google' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3.01h3.86c2.26-2.08 3.56-5.15 3.56-8.66z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.86-3a7.14 7.14 0 0 1-4.07 1.14c-3.13 0-5.78-2.12-6.73-4.96H1.24v3.11A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.27 14.26a7.2 7.2 0 0 1-.38-2.26c0-.79.14-1.55.38-2.26V6.63H1.24A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.24 5.37z" />
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.6 4.6 1.8l3.42-3.42A11.94 11.94 0 0 0 12 0 12 12 0 0 0 1.24 6.63l4.03 3.11C6.22 6.87 8.87 4.75 12 4.75z" />
      </svg>
      {children}
    </button>
  )
}

export function AuthError({ children }) {
  if (!children) return null
  return (
    <p role="alert" className="mt-3 rounded-lg bg-danger-tint px-3 py-2 text-xs font-medium text-danger">
      {children}
    </p>
  )
}

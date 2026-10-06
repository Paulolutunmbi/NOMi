import { Link } from 'react-router-dom'
import NomiLogo from './NomiLogo'

export default function LegalPage({ title, children }) {
  return (
    <div className="min-h-svh bg-surface-muted text-ink">
      <header className="flex items-center justify-between border-b border-line bg-surface px-5 py-4 sm:px-10">
        <Link to="/" aria-label="NOMI home"><NomiLogo /></Link>
        <nav className="flex gap-4 text-sm text-ink-soft" aria-label="Legal pages">
          <Link to="/privacy" className="hover:text-nomi-orange">Privacy</Link>
          <Link to="/terms" className="hover:text-nomi-orange">Terms</Link>
          <Link to="/sign-in" className="hover:text-nomi-orange">Sign in</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-nomi-orange">NOMI</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-ink-faint">Effective date: October 5, 2026</p>
          <div className="legal-copy mt-8 space-y-7 text-sm leading-7 text-ink-soft">{children}</div>
        </div>
      </main>
      <footer className="border-t border-line px-5 py-6 text-center text-xs text-ink-faint">
        <div className="flex justify-center gap-5"><Link to="/privacy" className="hover:text-ink">Privacy Policy</Link><Link to="/terms" className="hover:text-ink">Terms of Service</Link></div>
        <p className="mt-3">© {new Date().getFullYear()} NOMI. Not affiliated with Google.</p>
      </footer>
    </div>
  )
}

export function LegalSection({ title, children }) {
  return <section><h2 className="mb-2 text-lg font-semibold text-ink">{title}</h2>{children}</section>
}

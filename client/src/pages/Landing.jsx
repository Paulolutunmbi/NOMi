import { Link } from 'react-router-dom'
import NomiLogo from '../components/NomiLogo'

function Icon({ path }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-nomi-orange">
      <path d={path} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const FEATURES = [
  {
    title: 'Gmail assistance',
    body: 'Ask in plain language and NOMI works directly with your Gmail — no digging through folders or filters.',
    icon: 'M3.5 5.5h17v13h-17zM4.5 7l6.6 5a1.6 1.6 0 0 0 1.9 0l6.6-5',
  },
  {
    title: 'Email search',
    body: 'Find a message from last week, a thread with a specific person, or an email you half-remember, just by describing it.',
    icon: 'M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.7-4.7',
  },
  {
    title: 'Drafting and editing',
    body: 'NOMI writes a first draft, and you can ask for changes — a different tone, shorter, more formal — before anything is final.',
    icon: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5.5 16z',
  },
  {
    title: 'Approval before sending',
    body: 'Nothing goes out or gets changed without you saying yes first. Every send and every edit waits for your explicit approval.',
    icon: 'M20 6 9 17l-5-5',
  },
  {
    title: 'Calendar management',
    body: 'Check your schedule, find a free slot, or create and update events — all through the same conversation.',
    icon: 'M3.5 5h17v15h-17zM3.5 9.5h17M8 3v4M16 3v4',
  },
  {
    title: 'Privacy by design',
    body: "NOMI only accesses what you've explicitly connected and approved. Your Google access tokens are encrypted, and you can disconnect at any time.",
    icon: 'M12 3.5 5 6.5v5c0 5 3 8 7 9 4-1 7-4 7-9v-5Z',
  },
  {
    title: 'AI-assisted workflows',
    body: 'One conversation drives search, drafting, and sending — NOMI asks when something is ambiguous instead of guessing.',
    icon: 'M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8',
  },
]

export default function Landing() {
  return (
    <div className="min-h-svh bg-surface-muted">
      <header className="flex items-center justify-between px-5 py-5 sm:px-10">
        <NomiLogo />
        <nav className="flex items-center gap-2">
          <Link
            to="/sign-in"
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            to="/sign-up"
            className="rounded-xl bg-nomi-orange px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="px-5 pb-16 pt-10 text-center sm:px-10 sm:pt-16">
          <h1 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Your intelligent workspace for email and calendar
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink-soft">
            NOMI lets you talk to Gmail and Calendar in plain language — searching, drafting, and scheduling
            through one conversation, with your approval before anything is sent or changed.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/sign-up"
              className="rounded-xl bg-nomi-orange px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark"
            >
              Get started
            </Link>
            <Link
              to="/sign-in"
              className="rounded-xl border border-line-strong bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-nomi-orange"
            >
              Sign in
            </Link>
          </div>
          <p className="mx-auto mt-5 max-w-md text-xs text-ink-faint">
            Your NOMI account is separate from your Google account — you'll connect Gmail and Calendar
            as a second step, and only with the permissions you choose.
          </p>
        </section>

        {/* Features */}
        <section className="border-t border-line bg-surface px-5 py-14 sm:px-10">
          <h2 className="text-center text-xl font-semibold text-ink">What NOMI can do</h2>
          <div className="mx-auto mt-9 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-line bg-surface-muted p-5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-nomi-orange-tint">
                  <Icon path={feature.icon} />
                </span>
                <h3 className="mt-3.5 text-sm font-semibold text-ink">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-ink-faint">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-line px-5 py-16 text-center sm:px-10">
          <h2 className="text-xl font-semibold text-ink">Ready to let NOMI handle the busywork?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-faint">
            Create your NOMI account, then connect Gmail and Calendar when you're ready.
          </p>
          <Link
            to="/sign-up"
            className="mt-6 inline-block rounded-xl bg-nomi-orange px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark"
          >
            Get started
          </Link>
        </section>
      </main>

      <footer className="border-t border-line px-5 py-6 text-center text-xs text-ink-faint sm:px-10">
        © {new Date().getFullYear()} NOMI. Not affiliated with Google.
      </footer>
    </div>
  )
}

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'nomi.installBannerDismissedAt'
const DISMISS_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000 // 2 weeks

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS Safari
  )
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

function recentlyDismissed() {
  const raw = window.localStorage.getItem(DISMISS_KEY)
  if (!raw) return false
  const dismissedAt = Number(raw)
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_SNOOZE_MS
}

/**
 * A dismissible banner nudging people to install NOMI as an app, especially
 * on mobile. Chrome/Android fire `beforeinstallprompt`, which we capture and
 * replay when the user taps Install. iOS Safari never fires that event —
 * there's no programmatic install there — so we show manual "Add to Home
 * Screen" instructions instead of a button that would silently do nothing.
 */
export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [visible, setVisible] = useState(false)
  const [showIosSteps, setShowIosSteps] = useState(false)

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setDeferredPrompt(event)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

    // iOS never emits beforeinstallprompt, so surface manual instructions
    // there instead of staying silent.
    let iosTimer
    if (isIos()) {
      iosTimer = window.setTimeout(() => setVisible(true), 1500)
    }

    const onInstalled = () => {
      setVisible(false)
      setDeferredPrompt(null)
    }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      if (iosTimer) window.clearTimeout(iosTimer)
    }
  }, [])

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setVisible(false)
    setShowIosSteps(false)
  }

  const install = async () => {
    if (!deferredPrompt) {
      setShowIosSteps(true)
      return
    }
    deferredPrompt.prompt()
    try {
      await deferredPrompt.userChoice
    } finally {
      setDeferredPrompt(null)
      setVisible(false)
    }
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Install NOMI"
      className="flex flex-col gap-2 border-b border-line bg-nomi-orange-tint px-4 py-2.5 text-sm text-ink sm:flex-row sm:items-center sm:justify-between"
    >
      {!showIosSteps ? (
        <>
          <div className="flex items-center gap-2">
            <img src="/icon-32.png" alt="" width="20" height="20" className="shrink-0 rounded" />
            <span>Install NOMI on your device for quicker, full-screen access.</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={install}
              className="rounded-lg bg-nomi-orange px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-nomi-orange-dark"
            >
              Install
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-faint transition-colors hover:text-ink"
            >
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <img src="/icon-32.png" alt="" width="20" height="20" className="shrink-0 rounded" />
            <span>
              To install: tap the Share icon, then <strong>Add to Home Screen</strong>.
            </span>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-faint transition-colors hover:text-ink"
          >
            Got it
          </button>
        </>
      )}
    </div>
  )
}

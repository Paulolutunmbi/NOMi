import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'nomi.theme'
const VALID_THEMES = ['light', 'dark', 'system']

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches

const readStoredTheme = () => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return VALID_THEMES.includes(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

const applyResolvedTheme = (resolved) => {
  document.documentElement.dataset.theme = resolved
}

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme)
  const [systemIsDark, setSystemIsDark] = useState(systemPrefersDark)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const handleChange = (event) => setSystemIsDark(event.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const resolvedTheme = theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme

  useEffect(() => {
    applyResolvedTheme(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next) => {
    if (!VALID_THEMES.includes(next)) return
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Persisting the preference is a nice-to-have; the in-memory state still works this session.
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook belongs next to its provider
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

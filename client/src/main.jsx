import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AiIntentTestPage from './AiIntentTestPage.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'

// Temporary local-only route for exercising the AI intent pipeline directly.
const isTemporaryAiTestRoute = import.meta.env.DEV && window.location.pathname === '/ai-test'
const application = isTemporaryAiTestRoute ? <AiIntentTestPage /> : <App />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        {application}
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>,
)

// Register the service worker after the page has loaded so it never
// competes with the initial render for bandwidth/CPU. Skipped in dev so
// Vite's HMR isn't shadowed by a stale cached module.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability/offline support is a bonus, not a requirement — a
      // failed registration should never block the app from working.
    })
  })
}

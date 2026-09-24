import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AiIntentTestPage from './AiIntentTestPage.jsx'

// Temporary local-only route for exercising the AI intent pipeline directly.
const isTemporaryAiTestRoute = import.meta.env.DEV && window.location.pathname === '/ai-test'
const application = isTemporaryAiTestRoute ? <AiIntentTestPage /> : <App />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {application}
  </StrictMode>,
)

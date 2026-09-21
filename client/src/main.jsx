import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AiIntentTestPage from './AiIntentTestPage.jsx'
import DevelopmentAuthentication from './DevelopmentAuthentication.jsx'

const isTemporaryAiTestRoute = import.meta.env.DEV && window.location.pathname === '/ai-test'
const page = isTemporaryAiTestRoute ? <AiIntentTestPage /> : <App />
const application = import.meta.env.DEV
  ? <DevelopmentAuthentication>{page}</DevelopmentAuthentication>
  : page

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {application}
  </StrictMode>,
)

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import { RequireAuth, RequireGuest } from './components/RouteGuards'
import { useAuth } from './context/AuthContext'
import { ChatSidebarProvider } from './context/ChatSidebarContext'
import RootRoute from './pages/RootRoute'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import ForgotPassword from './pages/ForgotPassword'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'
import Settings from './pages/Settings'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'

function AuthenticatedApp() {
  const { user, signOut } = useAuth()

  return (
    <ChatSidebarProvider>
      <AppShell userLabel={user?.email} onSignOut={signOut}>
        <Routes>
          <Route index element={<Home />} />
          <Route path="chat/:chatId" element={<Home />} />
          <Route path="settings" element={<Settings />} />
          {/* Gmail and Calendar used to be separate tabs with their own chat
              threads — mail and calendar are both available from any chat now,
              so old bookmarked links just land on the unified chat list. */}
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </AppShell>
    </ChatSidebarProvider>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/sign-in" element={<RequireGuest><SignIn /></RequireGuest>} />
      <Route path="/sign-up" element={<RequireGuest><SignUp /></RequireGuest>} />
      <Route path="/forgot-password" element={<RequireGuest><ForgotPassword /></RequireGuest>} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route
        path="/app/*"
        element={
          <RequireAuth>
            <AuthenticatedApp />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App

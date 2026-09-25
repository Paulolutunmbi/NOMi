import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import { RequireAuth, RequireGuest } from './components/RouteGuards'
import { useAuth } from './context/AuthContext'
import RootRoute from './pages/RootRoute'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import ForgotPassword from './pages/ForgotPassword'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'
import Gmail from './pages/Gmail'
import CalendarPage from './pages/Calendar'
import Settings from './pages/Settings'

function AuthenticatedApp() {
  const { user, signOut } = useAuth()

  return (
    <AppShell userLabel={user?.email} onSignOut={signOut}>
      <Routes>
        <Route index element={<Home />} />
        <Route path="home/chat/:chatId" element={<Home />} />
        <Route path="gmail" element={<Gmail />} />
        <Route path="gmail/chat/:chatId" element={<Gmail />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="calendar/chat/:chatId" element={<CalendarPage />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </AppShell>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
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

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail as sendPasswordResetEmailFirebase,
  signInWithEmailAndPassword as signInWithEmailAndPasswordFirebase,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { auth } from '../config/firebase'

const googleProvider = new GoogleAuthProvider()

// "Continue with Google" here signs in to the NOMI account itself (an
// identity provider choice for Firebase auth) — it is a different flow from
// connecting a Google account for Gmail/Calendar access, which happens
// later via the backend's OAuth integration and asks for those specific
// scopes explicitly.
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider)

export const registerWithEmailAndPassword = async (email, password, displayName) => {
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  if (displayName) {
    await updateProfile(credential.user, { displayName }).catch(() => {})
  }
  return credential
}

export const signInWithEmailAndPassword = (email, password) =>
  signInWithEmailAndPasswordFirebase(auth, email, password)

export const signOutUser = () => signOut(auth)

// Sends a NOMI account password-reset email via Firebase. This is a real
// integration (Firebase already backs every NOMI account), not a stand-in —
// there is no separate NOMI-hosted recovery flow to build.
export const sendPasswordResetEmail = (email) => sendPasswordResetEmailFirebase(auth, email)

export const getCurrentIdToken = async (forceRefresh = false) => {
  if (!auth.currentUser) {
    return null
  }

  return auth.currentUser.getIdToken(forceRefresh)
}

export const observeAuthState = (callback) => onAuthStateChanged(auth, callback)

const FRIENDLY_AUTH_ERRORS = {
  'auth/email-already-in-use': 'An account with this email already exists. Try signing in instead.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/user-not-found': "We couldn't find a NOMI account with that email.",
  'auth/wrong-password': 'Incorrect password. Try again.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled before it finished.',
  'auth/network-request-failed': 'Check your internet connection and try again.',
}

// Firebase auth errors carry a stable `.code`; this maps the ones users can
// actually hit in this flow to plain-language copy, and otherwise falls back
// to the SDK's own message rather than exposing a raw error code.
export const friendlyAuthError = (error) =>
  FRIENDLY_AUTH_ERRORS[error?.code] || error?.message || 'Something went wrong. Please try again.'

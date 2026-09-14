import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword as signInWithEmailAndPasswordFirebase,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { auth } from '../config/firebase'

const googleProvider = new GoogleAuthProvider()

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider)

export const registerWithEmailAndPassword = (email, password) =>
  createUserWithEmailAndPassword(auth, email, password)

export const signInWithEmailAndPassword = (email, password) =>
  signInWithEmailAndPasswordFirebase(auth, email, password)

export const signOutUser = () => signOut(auth)

export const getCurrentIdToken = async (forceRefresh = false) => {
  if (!auth.currentUser) {
    return null
  }

  return auth.currentUser.getIdToken(forceRefresh)
}

export const observeAuthState = (callback) => onAuthStateChanged(auth, callback)

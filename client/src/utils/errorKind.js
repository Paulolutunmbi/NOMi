import { NomiApiError, NomiNetworkError } from '../api/nomiClient'

// Single place that decides which ErrorState copy an error maps to, so
// every screen (chat, onboarding, settings) explains the same failure the
// same way instead of each guessing independently.
export function errorKindFor(error) {
  if (error instanceof NomiNetworkError) return 'network'
  if (error instanceof NomiApiError) {
    switch (error.status) {
      case 400:
        return 'clientError'
      case 401:
        return 'auth'
      case 403:
        return 'forbidden'
      case 404:
        return 'notFound'
      case 408:
      case 504:
        return 'timeout'
      case 422:
        return 'rejected'
      case 429:
        return 'rateLimited'
      default:
        return 'server'
    }
  }
  return 'server'
}

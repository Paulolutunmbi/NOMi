import { NomiMark } from './NomiLogo'

export default function LoadingScreen({ label = 'Preparing your workspace…' }) {
  return (
    <div className="flex h-svh flex-col items-center justify-center gap-4 bg-surface-muted">
      <NomiMark size={40} />
      <div className="relative h-0.5 w-32 overflow-hidden rounded-full bg-line">
        <span
          className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-nomi-orange"
          style={{ animation: 'nomi-progress-sweep 1.1s ease-in-out infinite' }}
        />
      </div>
      <p className="text-sm text-ink-faint">{label}</p>
    </div>
  )
}

function NomiMark({ size = 28, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="#17140F" />
      <path d="M9 22V10h2.6l8.8 8.6V10h2.6v12h-2.6L11.6 13.4V22H9Z" fill="#F56B1A" />
    </svg>
  )
}

export default function NomiLogo({ size = 28, showWordmark = true, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <NomiMark size={size} />
      {showWordmark && (
        <span className="text-[17px] font-semibold tracking-tight text-ink">
          NOMI
        </span>
      )}
    </span>
  )
}

export { NomiMark }

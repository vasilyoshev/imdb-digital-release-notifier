/** Clapperboard mark — the app's glyph, in currentColor so it takes the amber accent. */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 9.5h18V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19V9.5Z" />
      <path d="M3.4 6 20 4l.6 3.4L4 9.5 3.4 6Z" fill="currentColor" stroke="none" />
      <path d="m7 5.4 1.8 3.3M11.5 4.9l1.8 3.3M16 4.4l1.8 3.3" strokeWidth="1.2" />
    </svg>
  );
}

export function NkSmile({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 40"
      className={`mx-auto block w-[min(320px,60%)] py-2 ${className}`}
      aria-hidden
    >
      <path
        d="M10 10 Q160 50 310 10"
        stroke="var(--brand)"
        strokeWidth={6}
        strokeLinecap="round"
        fill="none"
        opacity={0.85}
      />
    </svg>
  );
}
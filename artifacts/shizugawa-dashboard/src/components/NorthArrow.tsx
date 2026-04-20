export default function NorthArrow({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none flex flex-col items-center gap-0.5 bg-white/90 border border-border/60 rounded-lg shadow-sm px-2 py-2 ${className}`}
      style={{ backdropFilter: "blur(4px)" }}
      title="North is up"
    >
      <svg width="22" height="30" viewBox="0 0 22 30" fill="none" aria-hidden>
        {/* North half — solid dark */}
        <polygon points="11,1 17,15 11,11 5,15" fill="#1e293b" />
        {/* South half — outline only */}
        <polygon points="11,29 17,15 11,19 5,15" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" strokeLinejoin="round" />
        {/* Center pivot */}
        <circle cx="11" cy="15" r="1.8" fill="#1e293b" />
      </svg>
      <span
        style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1, color: "#1e293b" }}
      >
        N
      </span>
    </div>
  );
}

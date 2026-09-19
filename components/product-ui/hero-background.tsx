export function HeroBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute right-[-10%] top-[10%] h-[420px] w-[420px] rounded-full bg-brand/10 blur-[100px]" />
      <div className="absolute bottom-[5%] left-[5%] h-[280px] w-[280px] rounded-full bg-brand/[0.06] blur-[90px]" />
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.35]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="route-dots" width="48" height="48" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="#E4E4E7" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#route-dots)" />
        <path
          d="M80 180 C 220 120, 320 260, 480 190 S 720 120, 900 210"
          fill="none"
          stroke="#E11D48"
          strokeOpacity="0.12"
          strokeWidth="1.5"
          strokeDasharray="6 10"
          className="animate-dash-flow"
        />
        <path
          d="M120 420 C 280 360, 380 480, 560 400 S 820 340, 980 430"
          fill="none"
          stroke="#09090B"
          strokeOpacity="0.06"
          strokeWidth="1.5"
          strokeDasharray="4 12"
          className="animate-dash-flow"
        />
        <circle cx="220" cy="150" r="3" fill="#E11D48" fillOpacity="0.35" className="animate-route-drift" />
        <circle cx="560" cy="220" r="2.5" fill="#E11D48" fillOpacity="0.25" />
        <circle cx="820" cy="180" r="3" fill="#09090B" fillOpacity="0.15" className="animate-route-drift" />
      </svg>
    </div>
  );
}

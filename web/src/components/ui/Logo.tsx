
export interface LogoProps {
  className?: string;
  showText?: boolean;
  textClassName?: string;
}

export function Logo({ className = "h-8 w-8", showText = false, textClassName = "text-xl" }: LogoProps) {
  return (
    <div className="flex items-center gap-3 select-none">
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <defs>
          <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" /> {/* cyan-500 */}
            <stop offset="100%" stopColor="#3b82f6" /> {/* blue-500 */}
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/*
           Design Concept: "Geometric Intelligence" (Scheme 2)
           A tech-forward, polygonal representation of the DeerClaw identity.
           Constructed from sharp angles and nodes, symbolizing structure and AI.
        */}

        {/* Main Head Structure - Polygonal Shield */}
        <path
          d="M50 88
             L25 48
             L35 32
             L50 42
             L65 32
             L75 48
             Z"
          fill="url(#logo-gradient)"
          fillOpacity="0.1"
          stroke="url(#logo-gradient)"
          strokeWidth="3"
          strokeLinejoin="round"
        />

        {/* Internal Circuitry / Structure Lines */}
        <path
          d="M50 88 L50 58
             M25 48 L50 58 L75 48"
          stroke="url(#logo-gradient)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.6"
        />

        {/* Tech Antlers - Circuit Traces */}
        <path
          d="M35 32 L20 15
             M65 32 L80 15"
          stroke="url(#logo-gradient)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Antler Nodes/Branches */}
        <path
          d="M28 23 L36 16
             M72 23 L64 16"
          stroke="url(#logo-gradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Core Node / Eye - The Intelligence Center */}
        <circle cx="50" cy="58" r="4" fill="white" filter="url(#glow)" />

        {/* Data points at vertices */}
        <circle cx="25" cy="48" r="1.5" fill="#06b6d4" />
        <circle cx="75" cy="48" r="1.5" fill="#3b82f6" />

      </svg>

      {showText && (
        <span className={`font-bold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500 ${textClassName}`}>
          DeerClaw
        </span>
      )}
    </div>
  );
}

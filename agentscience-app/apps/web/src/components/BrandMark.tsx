import { cn } from "../lib/utils";

interface BrandMarkProps {
  className?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
  size?: number;
  showWordmark?: boolean;
}

/**
 * AgentScience brand mark: the laboratory flask containing a
 * constellation of connected accent-blue nodes, optionally paired
 * with the "AgentScience" wordmark in EB Garamond.
 *
 * The flask outline inherits `currentColor` so it adapts to its
 * container (sidebar, header, dialog). The constellation stays
 * brand blue — the single intentional spot of color.
 */
export function BrandMark({
  className,
  iconClassName,
  wordmarkClassName,
  size = 24,
  showWordmark = true,
}: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="240 200 544 544"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={cn("shrink-0", iconClassName)}
      >
        <g transform="translate(512, 488)">
          <path
            d="M-72,-260 L-72,-100 L-205,190 Q-215,222 -180,238 L180,238 Q215,222 205,190 L72,-100 L72,-260"
            fill="none"
            stroke="currentColor"
            strokeWidth={18}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <line
            x1={-102}
            y1={-260}
            x2={102}
            y2={-260}
            stroke="currentColor"
            strokeWidth={18}
            strokeLinecap="round"
          />
          <line x1={-50} y1={60} x2={40} y2={145} stroke="#3b5bdb" strokeWidth={6} opacity={0.3} />
          <line x1={40} y1={145} x2={90} y2={78} stroke="#3b5bdb" strokeWidth={6} opacity={0.3} />
          <line
            x1={-50}
            y1={60}
            x2={-108}
            y2={145}
            stroke="#3b5bdb"
            strokeWidth={6}
            opacity={0.3}
          />
          <line
            x1={-108}
            y1={145}
            x2={40}
            y2={145}
            stroke="#3b5bdb"
            strokeWidth={5}
            opacity={0.22}
          />
          <line x1={40} y1={145} x2={-24} y2={195} stroke="#3b5bdb" strokeWidth={5} opacity={0.22} />
          <line x1={-50} y1={60} x2={18} y2={20} stroke="#3b5bdb" strokeWidth={5} opacity={0.22} />
          <line x1={90} y1={78} x2={18} y2={20} stroke="#3b5bdb" strokeWidth={4.5} opacity={0.18} />
          <line
            x1={-108}
            y1={145}
            x2={-24}
            y2={195}
            stroke="#3b5bdb"
            strokeWidth={4.5}
            opacity={0.18}
          />
          <circle cx={-50} cy={60} r={20} fill="#3b5bdb" opacity={0.85} />
          <circle cx={40} cy={145} r={23} fill="#3b5bdb" opacity={0.92} />
          <circle cx={90} cy={78} r={17} fill="#3b5bdb" opacity={0.7} />
          <circle cx={-108} cy={145} r={18} fill="#3b5bdb" opacity={0.75} />
          <circle cx={-24} cy={195} r={14} fill="#3b5bdb" opacity={0.6} />
          <circle cx={18} cy={20} r={13} fill="#3b5bdb" opacity={0.55} />
        </g>
      </svg>
      {showWordmark ? (
        <span className={cn("as-brand-wordmark", wordmarkClassName)}>AgentScience</span>
      ) : null}
    </span>
  );
}

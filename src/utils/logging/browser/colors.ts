export const BROWSER_PEER_COLORS = [
    "#22d3ee", // cyan
    "#fbbf24", // yellow
    "#e879f9", // magenta
    "#4ade80", // green
    "#60a5fa", // blue
    "#f87171", // red
    "#67e8f9", // bright cyan
    "#f0abfc" // bright magenta
] as const;

export const BROWSER_LEVEL_CSS: Record<string, string> = {
    error: "color: #dc2626; font-weight: 700",
    warn: "color: #f97316; font-weight: 700",
    info: "color: #22c55e; font-weight: 700",
    debug: "color: #f59e0b; font-weight: 700",
    verbose: "color: #a855f7; font-weight: 700"
};

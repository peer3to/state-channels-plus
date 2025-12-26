import winston from "winston";

const Colors = {
    PEER: [
        "\x1b[36m", // Cyan
        "\x1b[33m", // Yellow
        "\x1b[35m", // Magenta
        "\x1b[32m", // Green
        "\x1b[34m", // Blue
        "\x1b[31m", // Red
        "\x1b[96m", // Bright Cyan
        "\x1b[95m" // Bright Magenta
    ] as const,
    LEVEL: {
        error: "\x1b[31m",
        warn: "\x1b[38;5;202m",
        info: "\x1b[92m",
        debug: "\x1b[38;5;208m",
        verbose: "\x1b[95m"
    },
    RESET: "\x1b[0m",
    COMPONENT: "\x1b[2m",
    TIMESTAMP: "\x1b[90m"
} as const;

function hashStringToColor(str: string): string {
    const traceColors = [
        "\x1b[38;5;196m",
        "\x1b[38;5;46m",
        "\x1b[38;5;226m",
        "\x1b[38;5;21m",
        "\x1b[38;5;208m",
        "\x1b[38;5;51m",
        "\x1b[38;5;201m",
        "\x1b[38;5;15m",
        "\x1b[38;5;244m",
        "\x1b[38;5;93m"
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash = hash & hash;
    }
    return traceColors[Math.abs(hash) % traceColors.length];
}

/**
 * Console formatter - colorful, human-readable output
 */
export const consoleFormat = () =>
    winston.format.printf(
        ({
            timestamp,
            level,
            message,
            component,
            traceId,
            peerId,
            peerAddress,
            ...meta
        }) => {
            let prefix = "";

            // Timestamp
            if (timestamp) {
                const timeValue =
                    typeof timestamp === "bigint"
                        ? Number(timestamp)
                        : (timestamp as string | number | Date);
                const time = new Date(timeValue).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });
                prefix += `${Colors.TIMESTAMP}[${time}]${Colors.RESET}`;
            }

            // Log level with color
            prefix += `${Colors.LEVEL[level as keyof typeof Colors.LEVEL] || Colors.LEVEL.debug}[${level.toUpperCase()}]${Colors.RESET}`;

            // Peer context (from log metadata, not config)
            if (peerId != null) {
                const peerColor =
                    Colors.PEER[Number(peerId) % Colors.PEER.length];
                prefix += `${peerColor}[Peer ${peerId}]${Colors.RESET}`;
                if (peerAddress && typeof peerAddress === "string") {
                    prefix += `${peerColor}[${peerAddress.slice(0, 8)}...]${Colors.RESET}`;
                }
            }

            // Component
            if (component)
                prefix += `${Colors.COMPONENT}[${component}]${Colors.RESET}`;

            // TraceId
            if (traceId) {
                const traceColor = hashStringToColor(String(traceId));
                prefix += `${traceColor}[${String(traceId).slice(0, 8)}]${Colors.RESET}`;
            }

            // Metadata (excluding already-displayed fields)
            const metaStr =
                Object.keys(meta).length > 0
                    ? ` ${JSON.stringify(meta, (key, value) => {
                          if (typeof value === "bigint") {
                              return value.toString();
                          }
                          return value;
                      })}`
                    : "";

            return `${prefix} ${message}${metaStr}`;
        }
    );

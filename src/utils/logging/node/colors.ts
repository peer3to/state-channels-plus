export const Colors = {
    // Peer colors for rotating assignment
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

    // Log level colors
    LEVEL: {
        error: "\x1b[31m", // Red
        warn: "\x1b[38;5;202m", // Bright Orange-Red
        info: "\x1b[92m", // Bright Green
        debug: "\x1b[38;5;208m", // Orange
        verbose: "\x1b[95m" // Bright Magenta
    },

    // UI element colors
    RESET: "\x1b[0m",
    SYSTEM: "\x1b[90m", // Gray for system/harness logs
    COMPONENT: "\x1b[2m", // Dim for component names
    TIMESTAMP: "\x1b[90m" // Gray for timestamps
} as const;

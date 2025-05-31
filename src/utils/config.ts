// Helper function to parse boolean values from environment variables
function parseBooleanEnv(
    value: string | undefined,
    defaultValue: boolean = false
): boolean {
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === "true";
}

// Configuration object with environment variables
export const config = {
    PROVIDER_URL: process.env.PROVIDER_URL || "http://localhost:8545",
    DEBUG_STATE_MANAGER: parseBooleanEnv(process.env.DEBUG_STATE_MANAGER),
    DEBUG_DISPUTE_HANDLER: parseBooleanEnv(process.env.DEBUG_DISPUTE_HANDLER),
    DEBUG_P2P_MANAGER: parseBooleanEnv(process.env.DEBUG_P2P_MANAGER),
    DEBUG_RPC: parseBooleanEnv(process.env.DEBUG_RPC),
    DEBUG_CHANNEL_CONTRACT: parseBooleanEnv(process.env.DEBUG_CHANNEL_CONTRACT),
    DEBUG_LOCAL_TRANSPORT: parseBooleanEnv(process.env.DEBUG_LOCAL_TRANSPORT)
} as const;

// Export individual config values for easy import
export const {
    PROVIDER_URL,
    DEBUG_STATE_MANAGER,
    DEBUG_DISPUTE_HANDLER,
    DEBUG_P2P_MANAGER,
    DEBUG_RPC,
    DEBUG_CHANNEL_CONTRACT,
    DEBUG_LOCAL_TRANSPORT
} = config;

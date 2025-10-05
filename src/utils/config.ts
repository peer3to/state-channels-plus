export interface Config {
    PROVIDER_URL: string;
    DEBUG_STATE_MANAGER: boolean;
    DEBUG_DISPUTE_HANDLER: boolean;
    DEBUG_P2P_MANAGER: boolean;
    DEBUG_RPC: boolean;
    DEBUG_CHANNEL_CONTRACT: boolean;
    DEBUG_LOCAL_TRANSPORT: boolean;
}

// Default configuration values
const DEFAULT_CONFIG: Config = {
    PROVIDER_URL: "http://localhost:8545",
    DEBUG_STATE_MANAGER: false,
    DEBUG_DISPUTE_HANDLER: false,
    DEBUG_P2P_MANAGER: false,
    DEBUG_RPC: false,
    DEBUG_CHANNEL_CONTRACT: false,
    DEBUG_LOCAL_TRANSPORT: false
};

function parseBooleanValue(value: any, defaultValue: boolean = false): boolean {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toLowerCase() === "true";
    return defaultValue;
}

// Load environment variables (Node.js only)
function loadConfigFromEnv(): Partial<Config> {
    try {
        if (typeof process === "undefined" || !process.env) {
            return {};
        }

        return {
            PROVIDER_URL: process.env.PROVIDER_URL,
            DEBUG_STATE_MANAGER:
                process.env.DEBUG_STATE_MANAGER !== undefined
                    ? parseBooleanValue(process.env.DEBUG_STATE_MANAGER)
                    : undefined,
            DEBUG_DISPUTE_HANDLER:
                process.env.DEBUG_DISPUTE_HANDLER !== undefined
                    ? parseBooleanValue(process.env.DEBUG_DISPUTE_HANDLER)
                    : undefined,
            DEBUG_P2P_MANAGER:
                process.env.DEBUG_P2P_MANAGER !== undefined
                    ? parseBooleanValue(process.env.DEBUG_P2P_MANAGER)
                    : undefined,
            DEBUG_RPC:
                process.env.DEBUG_RPC !== undefined
                    ? parseBooleanValue(process.env.DEBUG_RPC)
                    : undefined,
            DEBUG_CHANNEL_CONTRACT:
                process.env.DEBUG_CHANNEL_CONTRACT !== undefined
                    ? parseBooleanValue(process.env.DEBUG_CHANNEL_CONTRACT)
                    : undefined,
            DEBUG_LOCAL_TRANSPORT:
                process.env.DEBUG_LOCAL_TRANSPORT !== undefined
                    ? parseBooleanValue(process.env.DEBUG_LOCAL_TRANSPORT)
                    : undefined
        };
    } catch {
        return {};
    }
}

// Try to import user config file - falls back to defaults if not found
function loadUserConfig(): Partial<Config> {
    try {
        return require("../../peer3.config");
    } catch {
        return {};
    }
}

// Create unified configuration with precedence: defaults < config file < environment variables
function createConfig(): Config {
    const userConfig = loadUserConfig();
    const envConfig = loadConfigFromEnv();

    return {
        PROVIDER_URL:
            envConfig.PROVIDER_URL ??
            userConfig.PROVIDER_URL ??
            DEFAULT_CONFIG.PROVIDER_URL,
        DEBUG_STATE_MANAGER:
            envConfig.DEBUG_STATE_MANAGER ??
            userConfig.DEBUG_STATE_MANAGER ??
            DEFAULT_CONFIG.DEBUG_STATE_MANAGER,
        DEBUG_DISPUTE_HANDLER:
            envConfig.DEBUG_DISPUTE_HANDLER ??
            userConfig.DEBUG_DISPUTE_HANDLER ??
            DEFAULT_CONFIG.DEBUG_DISPUTE_HANDLER,
        DEBUG_P2P_MANAGER:
            envConfig.DEBUG_P2P_MANAGER ??
            userConfig.DEBUG_P2P_MANAGER ??
            DEFAULT_CONFIG.DEBUG_P2P_MANAGER,
        DEBUG_RPC:
            envConfig.DEBUG_RPC ??
            userConfig.DEBUG_RPC ??
            DEFAULT_CONFIG.DEBUG_RPC,
        DEBUG_CHANNEL_CONTRACT:
            envConfig.DEBUG_CHANNEL_CONTRACT ??
            userConfig.DEBUG_CHANNEL_CONTRACT ??
            DEFAULT_CONFIG.DEBUG_CHANNEL_CONTRACT,
        DEBUG_LOCAL_TRANSPORT:
            envConfig.DEBUG_LOCAL_TRANSPORT ??
            userConfig.DEBUG_LOCAL_TRANSPORT ??
            DEFAULT_CONFIG.DEBUG_LOCAL_TRANSPORT
    };
}

export const config = createConfig();

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

export { createConfig, DEFAULT_CONFIG };

// Function to override config for testing
export function overrideConfig(overrides: Partial<Config>): Config {
    return { ...config, ...overrides };
}

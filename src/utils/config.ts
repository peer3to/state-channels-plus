export interface Config {
    PROVIDER_URL: string;
    DEBUG_STATE_MANAGER: boolean;
    DEBUG_DISPUTE_HANDLER: boolean;
    DEBUG_P2P_MANAGER: boolean;
    DEBUG_RPC: boolean;
    DEBUG_CHANNEL_CONTRACT: boolean;
    DEBUG_LOCAL_TRANSPORT: boolean;
    RATE_LIMIT_ENABLED: boolean;
    RATE_LIMIT_BYTES_PER_SECOND: number;
    RATE_LIMIT_BURST_SIZE: number;
}

function isNode() {
    return (
        typeof process !== "undefined" &&
        process.versions &&
        process.versions.node
    );
}

const DEFAULT_CONFIG: Config = {
    PROVIDER_URL: "http://localhost:8545",
    DEBUG_STATE_MANAGER: false,
    DEBUG_DISPUTE_HANDLER: false,
    DEBUG_P2P_MANAGER: false,
    DEBUG_RPC: false,
    DEBUG_CHANNEL_CONTRACT: false,
    DEBUG_LOCAL_TRANSPORT: false,
    RATE_LIMIT_ENABLED: true,
    RATE_LIMIT_BYTES_PER_SECOND: 10 * 1024 * 1024, // 10 MB/s
    RATE_LIMIT_BURST_SIZE: 20 * 1024 * 1024 // 20 MB burst
};

// Create configuration: if node -> test config, else -> regular config, then apply overrides
function createConfig(overrides: Partial<Config> = {}): Config {
    let baseConfig: Partial<Config> = {};

    // If running in Node.js, use test config, otherwise use regular config
    if (isNode()) {
        try {
            const testConfigModule = require("../../test/peer3.test.config");
            baseConfig = testConfigModule.default || testConfigModule;
        } catch (e) {
            try {
                const regularConfigModule = require("../../peer3.config");
                baseConfig = regularConfigModule.default || regularConfigModule;
            } catch {
                // Use defaults if both fail
            }
        }
    } else {
        try {
            const regularConfigModule = require("../../peer3.config");
            baseConfig = regularConfigModule.default || regularConfigModule;
        } catch {
            // Use defaults if regular config fails
        }
    }

    return {
        ...DEFAULT_CONFIG,
        ...baseConfig,
        ...overrides
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

export { createConfig };

import fs from "fs";
import path from "path";

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "peer3.config.json");

// Helper function to parse boolean values
function parseBooleanValue(value: any, defaultValue: boolean = false): boolean {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toLowerCase() === "true";
    return defaultValue;
}

// Try to read config from JSON file
function loadConfigFromFile(configPath: string = DEFAULT_CONFIG_PATH) {
    try {
        if (!fs.existsSync(configPath)) {
            return {}; // File doesn't exist, use defaults
        }
        const raw = fs.readFileSync(configPath, "utf-8");
        return JSON.parse(raw);
    } catch (error) {
        console.warn(`Failed to load ${configPath}:`, error);
        return {}; // On error, use defaults
    }
}

// Load config once at startup
const fileConfig = loadConfigFromFile();

// Configuration with defaults
export const config = {
    PROVIDER_URL: fileConfig.PROVIDER_URL || "http://localhost:8545",
    DEBUG_STATE_MANAGER: parseBooleanValue(
        fileConfig.DEBUG_STATE_MANAGER,
        false
    ),
    DEBUG_DISPUTE_HANDLER: parseBooleanValue(
        fileConfig.DEBUG_DISPUTE_HANDLER,
        false
    ),
    DEBUG_P2P_MANAGER: parseBooleanValue(fileConfig.DEBUG_P2P_MANAGER, false),
    DEBUG_RPC: parseBooleanValue(fileConfig.DEBUG_RPC, false),
    DEBUG_CHANNEL_CONTRACT: parseBooleanValue(
        fileConfig.DEBUG_CHANNEL_CONTRACT,
        false
    ),
    DEBUG_LOCAL_TRANSPORT: parseBooleanValue(
        fileConfig.DEBUG_LOCAL_TRANSPORT,
        false
    )
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

// Export loadConfigFromFile for testing
export { loadConfigFromFile };

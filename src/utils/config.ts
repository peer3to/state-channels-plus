import peer3Config from "../../peer3.config";

export type Config = {
    PROVIDER_URL: string;
    DEBUG_STATE_MANAGER: boolean;
    DEBUG_DISPUTE_HANDLER: boolean;
    DEBUG_P2P_MANAGER: boolean;
    DEBUG_RPC: boolean;
    DEBUG_CHANNEL_CONTRACT: boolean;
    DEBUG_LOCAL_TRANSPORT: boolean;
    LOG_LEVEL: string;
    LOG_SKIP_WRITING: boolean;
    LOG_EXCLUDE_TAGS: string;
    EXCLUDE_LOG_TAGS: string;
    HOLEPUNCH_RELAYER_URLS: string[];
    // Crash log collection
    CRASH_LOG_UPLOAD_ENDPOINT: string;
    CRASH_LOG_API_TOKEN: string;
    CRASH_LOG_MAX_SIZE_MB: number;
};

const DEFAULT_CONFIG: Config = {
    PROVIDER_URL: "http://localhost:8545",
    DEBUG_STATE_MANAGER: false,
    DEBUG_DISPUTE_HANDLER: false,
    DEBUG_P2P_MANAGER: false,
    DEBUG_RPC: false,
    DEBUG_CHANNEL_CONTRACT: false,
    DEBUG_LOCAL_TRANSPORT: false,
    LOG_LEVEL: "info",
    LOG_SKIP_WRITING: false,
    LOG_EXCLUDE_TAGS: "",
    EXCLUDE_LOG_TAGS: "",
    HOLEPUNCH_RELAYER_URLS: [],
    // Crash log collection is enabled when upload endpoint is configured.
    CRASH_LOG_UPLOAD_ENDPOINT: "",
    CRASH_LOG_API_TOKEN: "",
    CRASH_LOG_MAX_SIZE_MB: 10
};

export function isNodeRuntime() {
    return (
        typeof process !== "undefined" &&
        process.versions &&
        process.versions.node
    );
}

type PartialConfig = Partial<Config>;

function parseBooleanEnv(value: unknown): boolean | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
    return undefined;
}

function coerceEnvValue(
    defaultValue: Config[keyof Config],
    raw: unknown
): Config[keyof Config] | undefined {
    if (raw == null) return undefined;
    if (typeof raw !== "string") return undefined;

    if (Array.isArray(defaultValue)) {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;

        // Allow JSON array syntax: HOLEPUNCH_RELAYER_URLS='["wss://...","wss://..."]'
        if (trimmed.startsWith("[")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (
                    Array.isArray(parsed) &&
                    parsed.every((v) => typeof v === "string")
                ) {
                    return parsed as any;
                }
            } catch {
                return undefined;
            }
        }

        // Fallback: comma/space separated.
        const items = trimmed
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);

        return items.length ? (items as any) : undefined;
    }

    if (typeof defaultValue === "boolean") {
        return parseBooleanEnv(raw);
    }
    if (typeof defaultValue === "number") {
        const n = Number(raw);
        return Number.isFinite(n) ? (n as any) : undefined;
    }
    if (typeof defaultValue === "string") {
        return raw;
    }

    // Unsupported types (objects, arrays) are ignored.
    return undefined;
}

function envOverrides(): PartialConfig {
    if (!isNodeRuntime()) return {};

    const env: Record<string, unknown> = process.env || {};
    const overrides: PartialConfig = {};

    const keys = Object.keys(DEFAULT_CONFIG) as Array<keyof Config>;
    for (const key of keys) {
        const parsed = coerceEnvValue(DEFAULT_CONFIG[key], env[key as string]);
        if (parsed !== undefined) {
            (overrides as Record<keyof Config, Config[keyof Config]>)[key] =
                parsed;
        }
    }
    return overrides;
}

const baseConfig: PartialConfig =
    peer3Config && typeof peer3Config === "object"
        ? (peer3Config as PartialConfig)
        : {};

// Process-lifespan singleton config object.
// Only this module can mutate it (via createConfig); other modules should only read.
export let config: Config = { ...DEFAULT_CONFIG };

/**
 * Computes and applies config for the current process.
 * Intended to be called once during p2pSetup.
 * Precedence: overrides > process.env > peer3.config.ts > defaults
 */
export function createConfig(overrides: PartialConfig = {}): Config {
    config = {
        ...DEFAULT_CONFIG,
        ...baseConfig,
        ...envOverrides(),
        ...overrides
    };
    // console.log("Config:", config);
    // console.log("Peer3 config", peer3Config);
    // console.log("Env overrides:", envOverrides());
    // console.log("Overrides:", overrides);
    return config;
}

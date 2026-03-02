import { Config } from "./src/utils/config";

const config: Partial<Config> = {
    PROVIDER_URL: "http://localhost:8545",
    DEBUG_STATE_MANAGER: false,
    DEBUG_DISPUTE_HANDLER: false,
    DEBUG_P2P_MANAGER: false,
    DEBUG_RPC: false,
    DEBUG_CHANNEL_CONTRACT: false,
    DEBUG_LOCAL_TRANSPORT: true,
    LOG_SKIP_WRITING: false,
    HOLEPUNCH_RELAYER_URLS: ["wss://dht1-relay.leet.ar:49443"],
    // Crash log collection enabled when endpoint is set
    CRASH_LOG_UPLOAD_ENDPOINT: "http://localhost:31001/logs/upload",
    // CRASH_LOG_API_TOKEN: "",
    CRASH_LOG_MAX_SIZE_MB: 20
};

export default config;

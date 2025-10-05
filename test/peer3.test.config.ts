import { Config } from "../src/utils/config";

const testConfig: Partial<Config> = {
    PROVIDER_URL: "http://localhost:8545",
    DEBUG_STATE_MANAGER: false,
    DEBUG_DISPUTE_HANDLER: false,
    DEBUG_P2P_MANAGER: false,
    DEBUG_RPC: false,
    DEBUG_CHANNEL_CONTRACT: false,
    DEBUG_LOCAL_TRANSPORT: true,
    RATE_LIMIT_ENABLED: false,
    RATE_LIMIT_BYTES_PER_SECOND: 0,
    RATE_LIMIT_BURST_SIZE: 0
};

export default testConfig;

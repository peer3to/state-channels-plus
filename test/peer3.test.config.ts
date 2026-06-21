import { Config } from "../src/utils/config";

const testConfig: Partial<Config> = {
    PROVIDER_URL: "http://localhost:8545",
    DEBUG_STATE_MANAGER: false,
    DEBUG_DISPUTE_HANDLER: false,
    DEBUG_P2P_MANAGER: false,
    DEBUG_RPC: false,
    DEBUG_CHANNEL_CONTRACT: false,
    DEBUG_LOCAL_TRANSPORT: true,
    VM_DEDICATED_THREAD: true,
    EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 1
};

export default testConfig;

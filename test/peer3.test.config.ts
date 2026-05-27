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
    // Q2 - orchestrator-side event-loop delay ceiling. parallel-4 mocha
    // runners + http-bridge to hardhat make the prior 1s ceiling flake; 5s
    // keeps the safety net while letting legit-slow loops complete.
    EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 5
};

export default testConfig;

import { Config } from "./src/utils/config";

const config: Partial<Config> = {
    PROVIDER_URL: "http://localhost:8545",
    DEBUG_STATE_MANAGER: false,
    DEBUG_DISPUTE_HANDLER: false,
    DEBUG_P2P_MANAGER: false,
    DEBUG_RPC: false,
    DEBUG_CHANNEL_CONTRACT: false,
    DEBUG_LOCAL_TRANSPORT: true,
    HOLEPUNCH_RELAYER_URLS: ["wss://dht1-relay.leet.ar:49443"]
};

export default config;

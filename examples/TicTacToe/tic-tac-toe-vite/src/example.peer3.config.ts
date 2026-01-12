// Example (committed) config overrides for @peer3/state-channels-plus.
//
// Usage:
// 1) Copy this file to `peer3.config.ts` in this same directory.
// 2) Update `HOLEPUNCH_RELAYER_URLS` to your relay(s).
//
// Note: `peer3.config.ts` is intended to be developer-specific (often gitignored).

const config = {
    PROVIDER_URL: "http://localhost:8545",

    // Logger defaults for this app
    LOG_LEVEL: "debug",
    DEBUG_LOCAL_TRANSPORT: false,

    // WebRTC/DHT relay URLs for browser Holepunch transport
    // Replace the placeholder with your own relay URL(s).
    HOLEPUNCH_RELAYER_URLS: ["wss://YOUR_RELAYER_HOST/dht-relay/"]
};

export default config;

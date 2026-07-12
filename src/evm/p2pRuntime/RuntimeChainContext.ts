import { Provider, Signer, Wallet, WebSocketProvider } from "ethers";

import type { Config } from "@/utils/config";

export interface RuntimeChainContext {
    provider: Provider;
    signer: Signer;
}

export function resolveWebSocketProviderUrl(providerUrl: string): string {
    if (/^wss?:\/\//i.test(providerUrl)) return providerUrl;
    if (/^https?:\/\//i.test(providerUrl)) {
        return providerUrl.replace(/^http(s?):\/\//i, "ws$1://");
    }
    throw new Error(
        "P2P runtime requires a ws:// or wss:// WebSocket provider URL"
    );
}

/** Build and verify the real-chain provider and wallet owned by one runtime host. */
export async function createRuntimeChainContext(
    config: Config,
    signerSecret: string
): Promise<RuntimeChainContext> {
    const wsUrl = resolveWebSocketProviderUrl(config.PROVIDER_URL);
    const provider = new WebSocketProvider(wsUrl);
    try {
        await provider.getNetwork();
    } catch (error) {
        await provider.destroy();
        throw new Error(
            `P2P runtime requires a reachable WebSocket provider at ${wsUrl}: ${String(error)}`
        );
    }
    const secret = signerSecret.trim();
    const signer = /^0x[0-9a-fA-F]{64}$/.test(secret)
        ? new Wallet(secret, provider)
        : Wallet.fromPhrase(secret).connect(provider);
    return { provider, signer };
}

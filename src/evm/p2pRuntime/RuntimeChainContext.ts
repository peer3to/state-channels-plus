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

function getSocketConnectionError(event: unknown): Error {
    if (event instanceof Error) return event;
    if (
        typeof event === "object" &&
        event !== null &&
        "error" in event &&
        event.error instanceof Error
    ) {
        return event.error;
    }
    return new Error("WebSocket connection failed");
}

async function waitForProviderNetwork(
    provider: WebSocketProvider
): Promise<void> {
    const websocket = provider.websocket;
    const previousOnError = websocket.onerror;
    let stopWatchingSocket!: () => void;
    let rejectSocketConnection!: (reason?: unknown) => void;
    const socketConnectionError = new Promise<void>((resolve, reject) => {
        stopWatchingSocket = resolve;
        rejectSocketConnection = reject;
    });
    const handleSocketConnectionError = (event: unknown) => {
        rejectSocketConnection(getSocketConnectionError(event));
    };
    websocket.onerror = handleSocketConnectionError;

    try {
        await Promise.race([provider.getNetwork(), socketConnectionError]);
    } finally {
        if (websocket.onerror === handleSocketConnectionError) {
            websocket.onerror = previousOnError;
        }
        stopWatchingSocket();
    }
}

/** Build and verify the real-chain provider and wallet owned by one runtime host. */
export async function createRuntimeChainContext(
    config: Config,
    signerSecret: string
): Promise<RuntimeChainContext> {
    const wsUrl = resolveWebSocketProviderUrl(config.PROVIDER_URL);
    const provider = new WebSocketProvider(wsUrl);
    // ethers does not install an `onerror` handler on its underlying socket.
    // In Node, `ws` therefore promotes a failed initial connection to an
    // uncaught Error instead of rejecting the provider readiness request.
    try {
        await waitForProviderNetwork(provider);
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

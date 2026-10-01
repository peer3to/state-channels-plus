import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import type { Config } from "@/utils/config";
import type { Logger } from "@/utils/logging/Logger";
import { Signer, Wallet } from "ethers";

export interface RuntimeChainContext {
    provider: MultiRpcProvider;
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

/**
 * The WebSocket URLs of the runtime's RPC nodes in priority order:
 * PROVIDER_URLS, or the single PROVIDER_URL when that list is unset or empty.
 */
export function resolveProviderUrls(
    config: Pick<Config, "PROVIDER_URL" | "PROVIDER_URLS">
): string[] {
    const urls = config.PROVIDER_URLS?.length
        ? config.PROVIDER_URLS
        : [config.PROVIDER_URL];
    return urls.map(resolveWebSocketProviderUrl);
}

/**
 * Build and verify the real-chain provider and wallet owned by one runtime
 * host. Startup needs one reachable node; the others keep reconnecting.
 */
export async function createRuntimeChainContext(
    config: Config,
    signerSecret: string,
    logger: Logger
): Promise<RuntimeChainContext> {
    const nodes = resolveProviderUrls(config).map(
        (url) => new RpcNodeProvider(url, logger)
    );
    const failures = await Promise.all(nodes.map((node) => node.firstAttempt));
    if (failures.every((failure) => failure !== undefined)) {
        for (const node of nodes) node.destroy();
        const reasons = nodes.map(
            (node, index) => `${node.url}: ${String(failures[index])}`
        );
        throw new Error(
            `P2P runtime requires a reachable WebSocket provider at ${reasons.join("; ")}`
        );
    }
    const provider = new MultiRpcProvider(nodes);
    const secret = signerSecret.trim();
    const signer = /^0x[0-9a-fA-F]{64}$/.test(secret)
        ? new Wallet(secret, provider)
        : Wallet.fromPhrase(secret).connect(provider);
    return { provider, signer };
}

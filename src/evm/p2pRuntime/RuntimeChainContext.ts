import MirrorRpcProvider, {
    type MirrorProviderOptions
} from "@/evm/p2pRuntime/rpcNodes/MirrorRpcProvider";
import type MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import RpcNodeProvider, {
    type ExpectedChain
} from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import {
    assertLogQueryMaxBlocks,
    assertMirrorMaxFollowedContracts,
    assertMirrorSampleRate,
    type Config
} from "@/utils/config";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import { Signer, Wallet } from "ethers";

export interface RuntimeChainContext {
    provider: MultiRpcProvider;
    signer: Signer;
}

export function resolveWebSocketProviderUrl(providerUrl: string): string {
    let webSocketUrl: string;
    if (/^wss?:\/\//i.test(providerUrl)) webSocketUrl = providerUrl;
    else if (/^https?:\/\//i.test(providerUrl))
        webSocketUrl = providerUrl.replace(/^http(s?):\/\//i, "ws$1://");
    else
        throw new Error(
            "P2P runtime requires a ws:// or wss:// WebSocket provider URL"
        );
    assertOpenableWebSocketUrl(webSocketUrl);
    return webSocketUrl;
}

/**
 * Rejects a URL a WebSocket cannot open: unparseable, an out-of-range port,
 * or a fragment. The error names the endpoint by scheme and host only.
 */
function assertOpenableWebSocketUrl(webSocketUrl: string): void {
    let parsed: URL | undefined;
    try {
        parsed = new URL(webSocketUrl);
    } catch {
        parsed = undefined;
    }
    if (!parsed || parsed.hash)
        throw new Error(
            `P2P runtime cannot open the WebSocket provider URL ${LoggerUtils.getRpcNodeMetadata(webSocketUrl).rpcNode}`
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
 * Settles `true` as soon as one node's first attempt connected, or `false`
 * once every first attempt failed.
 */
function anyNodeConnected(nodes: readonly RpcNodeProvider[]): Promise<boolean> {
    return new Promise((resolve) => {
        let failedCount = 0;
        for (const node of nodes) {
            void node.firstAttempt.then((failure) => {
                if (!failure) resolve(true);
                else if (++failedCount === nodes.length) resolve(false);
            });
        }
    });
}

/**
 * Build the multi-endpoint provider over the configured RPC nodes. Returns
 * once one node connected; the others keep connecting in the background.
 * Throws once every node's first attempt failed. The provider answers
 * latest-block reads from the local mirror kept by the storage diff service
 * at `config.STORAGE_DIFF_URL` (required); `mirror` supplies the precompiles
 * and owner of its EVM.
 */
export async function createRpcNodesProvider(
    config: Pick<
        Config,
        "PROVIDER_URL" | "PROVIDER_URLS" | "STORAGE_DIFF_URL"
    > &
        Partial<
            Pick<Config, "MIRROR_SAMPLE_RATE" | "MIRROR_MAX_FOLLOWED_CONTRACTS">
        >,
    logger: Logger,
    mirror: Pick<MirrorProviderOptions, "customPrecompiles" | "owner"> = {}
): Promise<MultiRpcProvider> {
    // a bad fraction would only mis-sample reads
    if (config.MIRROR_SAMPLE_RATE !== undefined)
        assertMirrorSampleRate(config.MIRROR_SAMPLE_RATE);
    // a bound the service refuses would stop the copy following new contracts
    if (config.MIRROR_MAX_FOLLOWED_CONTRACTS !== undefined)
        assertMirrorMaxFollowedContracts(config.MIRROR_MAX_FOLLOWED_CONTRACTS);
    const expectedChain: ExpectedChain = {};
    const nodes = resolveProviderUrls(config).map(
        (url) => new RpcNodeProvider(url, logger, expectedChain)
    );
    if (!(await anyNodeConnected(nodes))) {
        const failures = await Promise.all(
            nodes.map((node) => node.firstAttempt)
        );
        for (const node of nodes) node.destroy();
        // endpoint URLs can carry credentials in their path or query
        const reasons = nodes.map(
            (node, index) =>
                `${LoggerUtils.getRpcNodeMetadata(node.url).rpcNode}: ${String(failures[index])}`
        );
        throw new Error(
            `Chain access requires a reachable WebSocket provider at ${reasons.join("; ")}`
        );
    }
    return new MirrorRpcProvider(nodes, logger, {
        storageDiffUrl: config.STORAGE_DIFF_URL,
        sampleRate: config.MIRROR_SAMPLE_RATE,
        maxFollowedAccounts: config.MIRROR_MAX_FOLLOWED_CONTRACTS,
        ...mirror
    });
}

/**
 * Build and verify the real-chain provider and wallet owned by one runtime
 * host. The provider answers latest-block reads from the local mirror kept
 * by the storage diff service at `config.STORAGE_DIFF_URL` (required);
 * `mirror` supplies the precompiles and owner
 * of its EVM. Startup returns once one node connected; the others keep connecting
 * in the background.
 */
export async function createRuntimeChainContext(
    config: Config,
    signerSecret: string,
    logger: Logger,
    mirror: Pick<MirrorProviderOptions, "customPrecompiles" | "owner"> = {}
): Promise<RuntimeChainContext> {
    // a bad window size would only surface at the first catch-up
    assertLogQueryMaxBlocks(config.LOG_QUERY_MAX_BLOCKS);
    // checked before any node opens, so a missing service leaves nothing behind
    if (!config.STORAGE_DIFF_URL)
        throw new Error(
            "STORAGE_DIFF_URL is required: set the ws:// URL of the storage diff service"
        );
    const secret = signerSecret.trim();
    // derived before any node opens, so a bad secret leaves nothing behind
    const wallet = /^0x[0-9a-fA-F]{64}$/.test(secret)
        ? new Wallet(secret)
        : Wallet.fromPhrase(secret);
    const provider = await createRpcNodesProvider(config, logger, mirror);
    return { provider, signer: wallet.connect(provider) };
}

// @spec-test-coverage-ignore: node ownership helper; executable evidence belongs to its calling test declarations
import { startHardhatNode } from "../../utils/nodeInfra";
import { JsonRpcProvider } from "ethers";

/**
 * Runs `use` against a chain node this call exclusively owns, on its own
 * port, stopped in `finally`. Node-wide RPC methods (automine, mining,
 * snapshots) are safe here and only here: no other test shares the node.
 */
export async function withIsolatedHardhatNode<T>(
    use: (provider: JsonRpcProvider) => Promise<T>,
    options: { chainId?: number } = {}
): Promise<T> {
    const chainId = options.chainId ?? 31337;
    const node = await startHardhatNode({
        port: 0,
        env: { HARDHAT_CHAIN_ID: String(chainId) }
    });
    let provider: JsonRpcProvider | undefined;
    try {
        provider = new JsonRpcProvider(node.url, chainId, {
            staticNetwork: true
        });
        return await use(provider);
    } finally {
        provider?.destroy();
        node.stop();
        await node.exited;
    }
}

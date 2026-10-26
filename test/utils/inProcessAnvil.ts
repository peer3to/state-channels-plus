// @spec-test-coverage-ignore: test-chain infrastructure for hardhat's in-process network; executable evidence is in e2eParallelTestChain.test.ts
import type {
    EIP1193Provider,
    HardhatNetworkHDAccountsConfig,
    HardhatRuntimeEnvironment,
    HttpNetworkConfig,
    RequestArguments
} from "hardhat/types";
import { EventEmitter } from "node:events";

// How often a send under automine looks for its receipt, 20 ms apart.
const AUTOMINE_RECEIPT_POLLS = 100;

/** The network entry in hardhat.config.ts that configures the in-process chain. */
export const IN_PROCESS_NETWORK = "inProcess";

/**
 * Starts this process's own anvil on the first request and forwards every
 * request to it. anvil holds the whole account pool unlocked and signs, so it
 * assigns nonces the way EDR did; eth_accounts answers the hardhat network's
 * own account window, and sends settle one at a time, as EDR did.
 */
class LazyAnvilProvider extends EventEmitter implements EIP1193Provider {
    private chain?: Promise<EIP1193Provider>;
    // eth_sendTransaction requests, settled in the order they were made
    private sends: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly netConfig: HttpNetworkConfig,
        private readonly accounts: HardhatNetworkHDAccountsConfig
    ) {
        super();
    }

    async request(args: RequestArguments): Promise<unknown> {
        // the test task reads EDR's stack-trace failure count after mocha;
        // anvil has none
        if (args.method === "hardhat_getStackTraceFailuresCount") return 0;
        this.chain ??= this.start();
        const chain = await this.chain;
        if (
            args.method === "eth_sendTransaction" ||
            args.method === "eth_sendRawTransaction"
        ) {
            // anvil reads the sender's nonce per request, so concurrent sends
            // from one account would share it; EDR handled them one by one
            const sent = this.sends.then(() => this.send(chain, args));
            this.sends = sent.catch(() => undefined);
            return sent;
        }
        const result = await chain.request(args);
        if (args.method !== "eth_accounts") return result;
        const { initialIndex, count } = this.accounts;
        return (result as string[]).slice(initialIndex, initialIndex + count);
    }

    /**
     * Sends, and under automine returns once the transaction is mined, as EDR
     * did: anvil's automine mines just after the send returns. A transaction
     * that cannot mine yet (a nonce gap) returns after the wait instead.
     */
    private async send(chain: EIP1193Provider, args: RequestArguments) {
        const hash = (await chain.request(args)) as string;
        if (!(await chain.request({ method: "anvil_getAutomine" })))
            return hash;
        for (let attempt = 0; attempt < AUTOMINE_RECEIPT_POLLS; attempt++) {
            const receipt = await chain.request({
                method: "eth_getTransactionReceipt",
                params: [hash]
            });
            if (receipt) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return hash;
    }

    private async start(): Promise<EIP1193Provider> {
        const { startHardhatNode } = await import("./nodeInfra");
        const { HttpProvider } = await import(
            "hardhat/internal/core/providers/http"
        );
        const node = await startHardhatNode({
            port: 0,
            label: "in-process chain"
        });
        // the chain must neither keep this process alive nor outlive it
        node.proc.unref();
        for (const stream of [
            node.proc.stdin,
            node.proc.stdout,
            node.proc.stderr
        ]) {
            (stream as { unref?: () => void } | null)?.unref?.();
        }
        process.once("exit", () => node.stop());
        return new HttpProvider(
            node.url,
            "hardhat",
            this.netConfig.httpHeaders,
            this.netConfig.timeout
        );
    }
}

/**
 * Backs hardhat's in-process `hardhat` network with a private anvil instead
 * of EDR, keeping its name, so `ethers`, `network.provider` and the test task
 * see the network they always did. The chain starts like every other test
 * node (nodeInfra) and inherits the mining and chain id settings from the
 * environment, as hardhat.config.ts does; the `inProcess` network config
 * supplies the HTTP and gas settings.
 */
export function useAnvilForInProcessNetwork(hre: HardhatRuntimeEnvironment) {
    if (hre.network.name !== "hardhat") return;
    const netConfig = hre.config.networks[
        IN_PROCESS_NETWORK
    ] as HttpNetworkConfig;
    const accounts = hre.config.networks.hardhat
        .accounts as HardhatNetworkHDAccountsConfig;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
        applyProviderWrappers
    } = require("hardhat/internal/core/providers/construction");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
        BackwardsCompatibilityProviderAdapter
    } = require("hardhat/internal/core/providers/backwards-compatibility");
    hre.network.provider = new BackwardsCompatibilityProviderAdapter(
        applyProviderWrappers(
            new LazyAnvilProvider(netConfig, accounts),
            netConfig,
            []
        )
    );
}

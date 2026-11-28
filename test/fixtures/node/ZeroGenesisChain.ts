// @spec-test-coverage-ignore: private chain staging; executable evidence belongs to its calling test declarations
import { BrowserProvider } from "ethers";
import { config } from "hardhat";
import { createProvider } from "hardhat/internal/core/providers/construction";

// A private in-process chain whose genesis has timestamp 0, as on the
// parachain, then block 1 and one block per entry of `intervals` (seconds
// after the previous block), the last one at the wall clock.
export async function createZeroGenesisChain(
    intervals: number[]
): Promise<BrowserProvider> {
    const chain = await createProvider(
        {
            ...config,
            networks: {
                ...config.networks,
                hardhat: {
                    ...config.networks.hardhat,
                    initialDate: new Date(0).toISOString(),
                    mining: { ...config.networks.hardhat.mining, auto: true }
                }
            }
        },
        "hardhat"
    );
    let timestamp =
        Math.floor(Date.now() / 1000) - intervals.reduce((a, b) => a + b, 0);
    await chain.request({ method: "evm_mine", params: [timestamp] });
    for (const interval of intervals) {
        timestamp += interval;
        await chain.request({ method: "evm_mine", params: [timestamp] });
    }
    return new BrowserProvider(chain);
}

// @spec-test-coverage-ignore: test-owned clock input; executable evidence belongs to executor tests
import { AbstractProvider, Block, BlockTag, Network, Provider } from "ethers";

/** Shifts real chain block timestamps without changing the chain or Clock internals. */
export class TestClockProvider extends AbstractProvider {
    constructor(
        private readonly source: Provider,
        private readonly adjustmentSeconds: number
    ) {
        super();
    }
    override async _detectNetwork(): Promise<Network> {
        return this.source.getNetwork();
    }
    override async getBlock(
        block: BlockTag,
        prefetchTxs?: boolean
    ): Promise<Block | null> {
        const actual = await this.source.getBlock(block, prefetchTxs);
        if (!actual) return null;
        return new Proxy(actual, {
            get: (target, key, receiver) =>
                key === "timestamp"
                    ? target.timestamp + this.adjustmentSeconds
                    : Reflect.get(target, key, receiver)
        });
    }
}

import Clock from "@/Clock";
import { gasUsageReadSettleMs } from "@/rpc/internal/services/chainSigner/ChainSignerService";
import { createZeroGenesisChain } from "@test/fixtures/node/ZeroGenesisChain";
import { expect } from "chai";

describe("Gas-usage read settle", () => {
    it("waits three blocks at the measured block time when that fits half the request timeout", async () => {
        const chain = await createZeroGenesisChain([2, 2, 2]);
        await Clock.init(chain);

        expect(gasUsageReadSettleMs(30_000)).to.equal(6_000);
        chain.destroy();
    });

    it("waits half the request timeout when three blocks take longer", async () => {
        const chain = await createZeroGenesisChain([12, 12, 12]);
        await Clock.init(chain);

        expect(gasUsageReadSettleMs(30_000)).to.equal(15_000);
        chain.destroy();
    });

    it("waits three blocks when the request has no timeout", async () => {
        const chain = await createZeroGenesisChain([12, 12, 12]);
        await Clock.init(chain);

        expect(gasUsageReadSettleMs(null)).to.equal(36_000);
        chain.destroy();
    });
});

import { assertGasUsageReportedOnceOnDisposal } from "@test/fixtures/node/GasUsageDisposalFixture";

/**
 * The disposal report of the aggregated gas usage table: a peer must say once,
 * on its way out, what it spent on chain — including the transaction whose
 * receipt was still outstanding when it started leaving.
 */
describe("GasUsageDisposal", function () {
    it("reports the gas usage aggregate once when the participant is disposed", async function () {
        await assertGasUsageReportedOnceOnDisposal();
    });
});

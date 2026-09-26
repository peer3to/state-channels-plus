import GasUsageTable from "@/evm/gasUsage/GasUsageTable";
import * as factory from "@test/factory";
import { expect } from "chai";
import { ethers } from "ethers";

// Real manager selectors, so name and selector agree in every row below.
const POST_SELECTOR = ethers
    .id("postBlockCalldata((bytes,bytes),uint256)")
    .slice(0, 10);
const OPEN_SELECTOR = ethers.id("open((bytes,bytes[]))").slice(0, 10);
// Code-unit order decides the row order, and both are real checksummed
// addresses, so the test sorts them the way a reader would.
const [FIRST_MANAGER, SECOND_MANAGER] = [
    factory.randomWallet().address,
    factory.randomWallet().address
].sort();

describe("GasUsageTable", () => {
    it("reports no rows before a transaction is recorded", () => {
        const table = new GasUsageTable();

        expect(table.snapshot()).to.deep.equal([]);
    });

    it("reports one mined transaction as its own totals", () => {
        const table = new GasUsageTable();

        table.record({
            contractAddress: FIRST_MANAGER,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 120_000n,
            reverted: false
        });

        expect(table.snapshot()).to.deep.equal([
            {
                contractAddress: FIRST_MANAGER,
                functionSelector: POST_SELECTOR,
                functionName: "postBlockCalldata",
                successCount: 1,
                successGasUsed: "120000",
                minGasUsed: "120000",
                maxGasUsed: "120000",
                revertedCount: 0,
                revertedGasUsed: "0"
            }
        ]);
    });

    it("aggregates repeated calls of one function into count, total, min and max", () => {
        const table = new GasUsageTable();

        for (const gasUsed of [90_000n, 150_000n, 120_000n]) {
            table.record({
                contractAddress: FIRST_MANAGER,
                functionSelector: POST_SELECTOR,
                functionName: "postBlockCalldata",
                gasUsed,
                reverted: false
            });
        }

        const [row] = table.snapshot();
        expect(row.successCount).to.equal(3);
        // 90000 + 150000 + 120000
        expect(row.successGasUsed).to.equal("360000");
        expect(row.minGasUsed).to.equal("90000");
        expect(row.maxGasUsed).to.equal("150000");
    });

    it("keeps the gas of a reverted transaction out of the success bounds", () => {
        const table = new GasUsageTable();

        for (const gasUsed of [200_000n, 120_000n]) {
            table.record({
                contractAddress: FIRST_MANAGER,
                functionSelector: OPEN_SELECTOR,
                functionName: "open",
                gasUsed,
                reverted: false
            });
        }
        table.record({
            contractAddress: FIRST_MANAGER,
            functionSelector: OPEN_SELECTOR,
            functionName: "open",
            gasUsed: 30_000n,
            reverted: true
        });

        const [row] = table.snapshot();
        expect(row.successCount).to.equal(2);
        // 200000 + 120000, with the reverted 30000 in its own total
        expect(row.successGasUsed).to.equal("320000");
        // the cheapest success, not the cheaper failure
        expect(row.minGasUsed).to.equal("120000");
        expect(row.maxGasUsed).to.equal("200000");
        expect(row.revertedCount).to.equal(1);
        expect(row.revertedGasUsed).to.equal("30000");
    });

    it("reports a function that only ever reverted with empty success fields", () => {
        const table = new GasUsageTable();

        for (const gasUsed of [45_000n, 26_000n]) {
            table.record({
                contractAddress: FIRST_MANAGER,
                functionSelector: OPEN_SELECTOR,
                functionName: "open",
                gasUsed,
                reverted: true
            });
        }

        const [row] = table.snapshot();
        expect(row.successCount).to.equal(0);
        expect(row.successGasUsed).to.equal("0");
        expect(row.minGasUsed).to.equal("0");
        expect(row.maxGasUsed).to.equal("0");
        expect(row.revertedCount).to.equal(2);
        // 45000 + 26000
        expect(row.revertedGasUsed).to.equal("71000");
    });

    it("keeps the same selector on two contracts in separate rows", () => {
        const table = new GasUsageTable();

        table.record({
            contractAddress: FIRST_MANAGER,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 100_000n,
            reverted: false
        });
        table.record({
            contractAddress: SECOND_MANAGER,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 70_000n,
            reverted: false
        });

        const rows = table.snapshot();
        expect(rows.length).to.equal(2);
        expect(rows.map((row) => row.contractAddress)).to.deep.equal([
            FIRST_MANAGER,
            SECOND_MANAGER
        ]);
        expect(rows.map((row) => row.successGasUsed)).to.deep.equal([
            "100000",
            "70000"
        ]);
    });

    it("orders rows by contract address and then by function name", () => {
        const table = new GasUsageTable();

        table.record({
            contractAddress: SECOND_MANAGER,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 1n,
            reverted: false
        });
        table.record({
            contractAddress: FIRST_MANAGER,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 1n,
            reverted: false
        });
        table.record({
            contractAddress: FIRST_MANAGER,
            functionSelector: OPEN_SELECTOR,
            functionName: "open",
            gasUsed: 1n,
            reverted: false
        });

        expect(
            table
                .snapshot()
                .map((row) => `${row.contractAddress}:${row.functionName}`)
        ).to.deep.equal([
            `${FIRST_MANAGER}:open`,
            `${FIRST_MANAGER}:postBlockCalldata`,
            `${SECOND_MANAGER}:postBlockCalldata`
        ]);
    });

    it("keeps a gas total that exceeds the safe integer range exact", () => {
        const table = new GasUsageTable();
        const hugeGasUsed = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

        table.record({
            contractAddress: FIRST_MANAGER,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: hugeGasUsed,
            reverted: false
        });
        table.record({
            contractAddress: FIRST_MANAGER,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 1n,
            reverted: false
        });

        const [row] = table.snapshot();
        expect(row.successGasUsed).to.equal((hugeGasUsed + 1n).toString());
        // the snapshot must survive the port and the logger as it is
        expect(JSON.parse(JSON.stringify(row)).successGasUsed).to.equal(
            (hugeGasUsed + 1n).toString()
        );
    });
});

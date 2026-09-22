import GasUsageTable from "@/evm/gasUsage/GasUsageTable";
import { expect } from "chai";

const MANAGER_ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_MANAGER_ADDRESS = "0x2222222222222222222222222222222222222222";
const POST_SELECTOR = "0x0a0b0c0d";
const OPEN_SELECTOR = "0x1a1b1c1d";

describe("GasUsageTable", () => {
    it("reports no rows before a transaction is recorded", () => {
        const table = new GasUsageTable();

        expect(table.snapshot()).to.deep.equal([]);
    });

    it("reports one mined transaction as its own totals", () => {
        const table = new GasUsageTable();

        table.record({
            contractAddress: MANAGER_ADDRESS,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 120_000n,
            reverted: false
        });

        expect(table.snapshot()).to.deep.equal([
            {
                contractAddress: MANAGER_ADDRESS,
                functionSelector: POST_SELECTOR,
                functionName: "postBlockCalldata",
                minedCount: 1,
                revertedCount: 0,
                totalGasUsed: "120000",
                minGasUsed: "120000",
                maxGasUsed: "120000"
            }
        ]);
    });

    it("aggregates repeated calls of one function into count, total, min and max", () => {
        const table = new GasUsageTable();

        for (const gasUsed of [90_000n, 150_000n, 120_000n]) {
            table.record({
                contractAddress: MANAGER_ADDRESS,
                functionSelector: POST_SELECTOR,
                functionName: "postBlockCalldata",
                gasUsed,
                reverted: false
            });
        }

        const [row] = table.snapshot();
        expect(row.minedCount).to.equal(3);
        // 90000 + 150000 + 120000
        expect(row.totalGasUsed).to.equal("360000");
        expect(row.minGasUsed).to.equal("90000");
        expect(row.maxGasUsed).to.equal("150000");
    });

    it("counts a reverted transaction separately while keeping its gas in the totals", () => {
        const table = new GasUsageTable();

        table.record({
            contractAddress: MANAGER_ADDRESS,
            functionSelector: OPEN_SELECTOR,
            functionName: "open",
            gasUsed: 200_000n,
            reverted: false
        });
        table.record({
            contractAddress: MANAGER_ADDRESS,
            functionSelector: OPEN_SELECTOR,
            functionName: "open",
            gasUsed: 30_000n,
            reverted: true
        });

        const [row] = table.snapshot();
        expect(row.minedCount).to.equal(2);
        expect(row.revertedCount).to.equal(1);
        // the reverted transaction burned 30000 of the 230000
        expect(row.totalGasUsed).to.equal("230000");
        expect(row.minGasUsed).to.equal("30000");
        expect(row.maxGasUsed).to.equal("200000");
    });

    it("keeps the same selector on two contracts in separate rows", () => {
        const table = new GasUsageTable();

        table.record({
            contractAddress: MANAGER_ADDRESS,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 100_000n,
            reverted: false
        });
        table.record({
            contractAddress: OTHER_MANAGER_ADDRESS,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 70_000n,
            reverted: false
        });

        const rows = table.snapshot();
        expect(rows.length).to.equal(2);
        expect(rows.map((row) => row.contractAddress)).to.deep.equal([
            MANAGER_ADDRESS,
            OTHER_MANAGER_ADDRESS
        ]);
        expect(rows.map((row) => row.totalGasUsed)).to.deep.equal([
            "100000",
            "70000"
        ]);
    });

    it("orders rows by contract address and then by function name", () => {
        const table = new GasUsageTable();

        table.record({
            contractAddress: OTHER_MANAGER_ADDRESS,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 1n,
            reverted: false
        });
        table.record({
            contractAddress: MANAGER_ADDRESS,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 1n,
            reverted: false
        });
        table.record({
            contractAddress: MANAGER_ADDRESS,
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
            `${MANAGER_ADDRESS}:open`,
            `${MANAGER_ADDRESS}:postBlockCalldata`,
            `${OTHER_MANAGER_ADDRESS}:postBlockCalldata`
        ]);
    });

    it("keeps a gas total that exceeds the safe integer range exact", () => {
        const table = new GasUsageTable();
        const hugeGasUsed = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

        table.record({
            contractAddress: MANAGER_ADDRESS,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: hugeGasUsed,
            reverted: false
        });
        table.record({
            contractAddress: MANAGER_ADDRESS,
            functionSelector: POST_SELECTOR,
            functionName: "postBlockCalldata",
            gasUsed: 1n,
            reverted: false
        });

        const [row] = table.snapshot();
        expect(row.totalGasUsed).to.equal((hugeGasUsed + 1n).toString());
        // the snapshot must survive the port and the logger as it is
        expect(JSON.parse(JSON.stringify(row)).totalGasUsed).to.equal(
            (hugeGasUsed + 1n).toString()
        );
    });
});

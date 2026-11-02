// @spec-test-coverage-ignore: real SDK startup and disposal staging; declarations live in GasUsageDisposal.test.ts
import { createLoggerSdkFixture } from "./LoggerServiceFixture";
import {
    decodeUpload,
    startLogReceiver,
    type LogReceiver
} from "../logging/LogUploader.fixture";
import type { GasUsageRow } from "@/evm/gasUsage/GasUsageTable";
import { expect } from "chai";
import { ethers, Wallet } from "ethers";

/** The metadata `LoggerUtils.getGasUsageMetadata` puts on the report line. */
interface GasUsageReport {
    functionCount: number;
    gasUsage: GasUsageRow[];
}

function uploadedGasUsageReports(receiver: LogReceiver): GasUsageReport[] {
    return receiver.requests
        .flatMap(decodeUpload)
        .filter((entry) => entry.message === "gas usage")
        .map((entry) => entry.meta[0] as GasUsageReport);
}

/**
 * Disposal must report the peer's chain spending once, and the receipt that
 * was still outstanding when disposal started must be in it. The SDK runs in
 * a worker; the oracle is the log upload the disposal flushes before the
 * worker ends.
 */
export async function assertGasUsageReportedOnceOnDisposal(): Promise<void> {
    const receiver = await startLogReceiver();
    const sdk = await createLoggerSdkFixture(receiver);
    try {
        expect(
            uploadedGasUsageReports(receiver),
            "nothing is reported yet"
        ).to.have.length(0);
        const functionSelector = ethers
            .id("postBlockCalldata((bytes,bytes),uint256)")
            .slice(0, 10);
        const callee = Wallet.createRandom().address;

        // Only the broadcast is awaited. The receipt is still outstanding when
        // disposal starts, which is exactly when a peer's last sends happen.
        await sdk.instance.chainSigner.sendTransaction({
            to: callee,
            data: functionSelector
        });
        await sdk.instance.dispose();

        const reports = uploadedGasUsageReports(receiver);
        expect(
            reports,
            "the aggregate is reported exactly once"
        ).to.have.length(1);
        expect(reports[0].functionCount).to.equal(1);
        expect(reports[0].gasUsage[0].contractAddress).to.equal(callee);
        expect(reports[0].gasUsage[0].functionSelector).to.equal(
            functionSelector
        );
        expect(reports[0].gasUsage[0].functionName).to.equal(
            "postBlockCalldata"
        );
        expect(reports[0].gasUsage[0].successCount).to.equal(1);
        expect(
            BigInt(reports[0].gasUsage[0].successGasUsed) > 0n,
            "a mined call burns gas"
        ).to.equal(true);
    } finally {
        await sdk.dispose();
        await receiver.close();
    }
}

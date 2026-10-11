import {
    isProvenSubmissionFailure,
    tryDecodeCustomError
} from "@/utils/evmErrorHandler";
import * as factory from "@test/factory";
import {
    founderSubmitter,
    maxTimestamp,
    rejectionOf
} from "@test/fixtures/ProvenSubmissionFailureStaging";
import { expect } from "chai";
import { ethers } from "ethers";

describe("isProvenSubmissionFailure", function () {
    it("a submission the chain refuses with a decoded custom error is a proven failure", async function () {
        const { manager, signer } = await founderSubmitter();
        // the factory block names another author than the founder that sends it
        const error = await rejectionOf(
            manager.postBlockCalldata(
                factory.signedBlock(),
                await maxTimestamp(signer)
            )
        );

        const custom = tryDecodeCustomError(error);
        expect(custom?.name).to.equal(
            "ErrorBlockCalldataMsgSenderNotBlockAuthor"
        );
        expect(isProvenSubmissionFailure(error, custom)).to.equal(true);
    });

    it("a mined submission whose receipt failed is a proven failure, with no decoded reason", async function () {
        const { manager, signer } = await founderSubmitter();
        const signedBlock = factory.signedBlock();
        const timestamp = await maxTimestamp(signer);
        const data = manager.interface.encodeFunctionData("postBlockCalldata", [
            signedBlock,
            timestamp
        ]);
        // gas for the calldata and little else: the transaction is mined
        // and runs out of gas
        const calldataGas = 16n * BigInt((data.length - 2) / 2);
        const tx = await manager.postBlockCalldata(signedBlock, timestamp, {
            gasLimit: 21_000n + calldataGas + 5_000n
        });
        const error = await rejectionOf(tx.wait());

        expect(ethers.isError(error, "CALL_EXCEPTION")).to.equal(true);
        expect(
            (await signer.provider!.getTransactionReceipt(tx.hash))?.status
        ).to.equal(0);
        const custom = tryDecodeCustomError(error);
        expect(custom).to.equal(null);
        expect(isProvenSubmissionFailure(error, custom)).to.equal(true);
    });

    it("a submission that fails with no receipt and no decoded revert is not a proven failure", async function () {
        const { signer } = await founderSubmitter();
        const address = await signer.getAddress();
        const balance = await signer.provider!.getBalance(address);
        // more value than the account holds: refused before it is mined
        const error = await rejectionOf(
            signer.sendTransaction({ to: address, value: balance + 1n })
        );

        const custom = tryDecodeCustomError(error);
        expect(custom).to.equal(null);
        expect(isProvenSubmissionFailure(error, custom)).to.equal(false);
    });

    it("a reverted call with no receipt and no revert data is not a proven failure", async function () {
        const { manager, signer } = await founderSubmitter();
        // the proxy fallback takes no value: the call reverts without data
        // before any transaction is sent
        const error = await rejectionOf(
            signer.sendTransaction({
                to: await manager.getAddress(),
                value: 1n
            })
        );

        expect(ethers.isError(error, "CALL_EXCEPTION")).to.equal(true);
        expect(
            ethers.isError(error, "CALL_EXCEPTION") ? error.receipt : "other"
        ).to.equal(undefined);
        const custom = tryDecodeCustomError(error);
        expect(custom).to.equal(null);
        expect(isProvenSubmissionFailure(error, custom)).to.equal(false);
    });
});

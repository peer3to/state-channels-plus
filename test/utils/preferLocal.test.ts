import { ContractExecutor } from "@/evm";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import { LOCAL_EVM_EXECUTION_FAILED } from "@/utils";
import { preferLocal } from "@/utils/localDiamond";
import { EVM } from "@ethereumjs/evm";
import { expect } from "chai";
import { ethers } from "ethers";

// A local diamond revert as the local signer surfaces it after the executor
// reported it (ContractExecutor → LocalContractExecutorSigner.call).
const localRevert = () =>
    new Error(
        `Local contract call failed: Error: ${LOCAL_EVM_EXECUTION_FAILED}: ErrorInvalidStateProof`
    );

describe("Unit: preferLocal", () => {
    it("keeps an acceptable local answer without asking the chain", async () => {
        let chainReads = 0;
        const answer = await preferLocal(
            async () => true,
            async () => {
                chainReads++;
                return false;
            },
            (isValid) => isValid
        );

        expect(answer).to.equal(true);
        expect(chainReads).to.equal(0);
    });

    it("asks the chain when the local answer would make the node act", async () => {
        let chainReads = 0;
        const answer = await preferLocal(
            async () => false,
            async () => {
                chainReads++;
                return true;
            },
            (isValid) => isValid
        );

        expect(answer).to.equal(true);
        expect(chainReads).to.equal(1);
    });

    it("propagates a local revert without asking the chain", async () => {
        let chainReads = 0;
        const failure = localRevert();
        const read = preferLocal(
            async () => {
                throw failure;
            },
            async () => {
                chainReads++;
                return true;
            },
            (isValid) => isValid
        );

        await read.then(
            () => expect.fail("the local failure must propagate"),
            (error: unknown) => expect(error).to.equal(failure)
        );
        expect(chainReads).to.equal(0);
    });

    it("propagates the chain's rejection of a confirmation read", async () => {
        const rejection = new Error("chain rejected the confirmation read");
        const read = preferLocal(
            async () => false,
            async () => {
                throw rejection;
            },
            (isValid) => isValid
        );

        await read.then(
            () => expect.fail("the chain rejection must propagate"),
            (error: unknown) => expect(error).to.equal(rejection)
        );
    });

    it("propagates a real local signer failure without asking the chain", async () => {
        const executor = new ContractExecutor(await EVM.create());
        try {
            const signer = new LocalContractExecutorSigner(
                ethers.Wallet.createRandom(),
                executor
            );
            let chainReads = 0;
            // a call with no target never reaches the EVM
            const read = preferLocal(
                () => signer.call({ data: "0x" }),
                async () => {
                    chainReads++;
                    return "0x";
                },
                () => true
            );

            await read.then(
                () => expect.fail("the signer failure must propagate"),
                (error: unknown) => {
                    expect(String(error)).to.contain("requires tx.to");
                }
            );
            expect(chainReads).to.equal(0);
        } finally {
            await executor.dispose();
        }
    });

    it("propagates an acceptance-callback failure without asking the chain", async () => {
        const failure = new Error("acceptance callback failed");
        let chainReads = 0;
        const read = preferLocal(
            async () => true,
            async () => {
                chainReads++;
                return true;
            },
            () => {
                throw failure;
            }
        );

        await read.then(
            () => expect.fail("the callback failure must propagate"),
            (error: unknown) => expect(error).to.equal(failure)
        );
        expect(chainReads).to.equal(0);
    });
});

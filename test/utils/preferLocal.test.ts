import { deployMathMachine } from "../fixtures/LocalEvmCallGas.fixture";
import { ContractExecutor } from "@/evm";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import {
    LOCAL_EVM_EXECUTION_FAILED,
    isLocalEvmExecutionFailure
} from "@/utils";
import { preferLocal } from "@/utils/localDiamond";
import { EVM } from "@ethereumjs/evm";
import { MathStateMachine__factory } from "@typechain-types";
import { expect } from "chai";
import { ethers } from "ethers";

// A local diamond revert as the local signer surfaces it after the executor
// reported it (ContractExecutor → LocalContractExecutorSigner.call).
const localRevert = () =>
    new Error(
        `Local contract call failed: Error: ${LOCAL_EVM_EXECUTION_FAILED}: ErrorInvalidStateProof`
    );

// A transition budget whose full stipend needs more call gas than the EVM
// default the executor grants.
const BUDGET_ABOVE_DEFAULT_CALL_GAS = 17_000_000n;

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

    it("asks the chain when the local EVM reverts", async () => {
        let chainReads = 0;
        const answer = await preferLocal(
            async () => {
                throw localRevert();
            },
            async () => {
                chainReads++;
                return true;
            },
            (isValid) => isValid
        );

        expect(isLocalEvmExecutionFailure(localRevert())).to.equal(true);
        expect(answer).to.equal(true);
        expect(chainReads).to.equal(1);
    });

    it("propagates a local failure that is not a revert without asking the chain", async () => {
        let chainReads = 0;
        const failure = new Error("Runtime child disposed");
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

        expect(isLocalEvmExecutionFailure(failure)).to.equal(false);
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

    it("propagates the chain's rejection of a read that replaces a local revert", async () => {
        const rejection = new Error("chain rejected the fallback read");
        const read = preferLocal(
            async () => {
                throw localRevert();
            },
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

    it("asks the chain when a real local contract call reverts in the executor", async () => {
        const executor = new ContractExecutor(await EVM.create());
        try {
            // the default call gas cannot grant this machine its stipend, so
            // its state transition reverts inside the executor's EVM
            const machine = await deployMathMachine(
                executor,
                BUDGET_ABOVE_DEFAULT_CALL_GAS
            );
            const contract = MathStateMachine__factory.connect(
                machine.address,
                new LocalContractExecutorSigner(
                    ethers.Wallet.createRandom(),
                    executor
                )
            );
            let localFailure: unknown;
            let chainReads = 0;
            const answer = await preferLocal(
                async () => {
                    try {
                        await contract.stateTransition.staticCall(
                            machine.addOneTransaction
                        );
                        return true;
                    } catch (error) {
                        localFailure = error;
                        throw error;
                    }
                },
                async () => {
                    chainReads++;
                    return false;
                },
                (isValid) => isValid
            );

            expect(isLocalEvmExecutionFailure(localFailure)).to.equal(true);
            expect(answer).to.equal(false);
            expect(chainReads).to.equal(1);
        } finally {
            await executor.dispose();
        }
    });

    it("propagates a real local signer failure that is not a revert without asking the chain", async () => {
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
                    expect(isLocalEvmExecutionFailure(error)).to.equal(false);
                    expect(String(error)).to.contain("requires tx.to");
                }
            );
            expect(chainReads).to.equal(0);
        } finally {
            await executor.dispose();
        }
    });

    it("classifies a non-Error local failure by its text", async () => {
        let chainReads = 0;
        const answer = await preferLocal(
            async () => {
                throw `${LOCAL_EVM_EXECUTION_FAILED}: revert`;
            },
            async () => {
                chainReads++;
                return true;
            },
            (isValid) => isValid
        );
        expect(answer).to.equal(true);
        expect(chainReads).to.equal(1);

        const failure = "runtime closed";
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
            () => expect.fail("the non-revert failure must propagate"),
            (error: unknown) => expect(error).to.equal(failure)
        );
        expect(chainReads).to.equal(1);
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

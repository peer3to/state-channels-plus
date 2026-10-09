import {
    createDiamondStateMachine,
    deployMathMachine,
    encodeMathState
} from "../fixtures/LocalEvmCallGas.fixture";
import { ContractExecutor } from "@/evm";
import { EVM } from "@ethereumjs/evm";
import { expect } from "chai";
import { ethers } from "ethers";

// The Math machine's transition budget in the harness.
const DEFAULT_BUDGET = 500_000n;

// The Math machine holds one participant whose turn is next (its live state).
async function deployLiveMachine() {
    const executor = new ContractExecutor(
        // the runtime's EVM option: the local diamond exceeds EIP-170
        await EVM.create({ allowUnlimitedContractSize: true })
    );
    const machine = await deployMathMachine(executor, DEFAULT_BUDGET);
    const stateMachine = await createDiamondStateMachine(
        executor,
        machine.address,
        DEFAULT_BUDGET
    );
    return {
        stateMachine,
        liveWriter: machine.addOneTransaction.header.participant,
        liveState: await stateMachine.getState()
    };
}

describe("Unit: EvmDiamondStateMachine peekNextToWrite", function () {
    it("a state whose second participant is next, peeked on a machine whose live state has another next writer -> returns that second participant; getState and getNextToWrite still return the live state's", async function () {
        const { stateMachine, liveWriter, liveState } =
            await deployLiveMachine();
        const second = ethers.Wallet.createRandom().address;
        const peeked = encodeMathState({
            number: 7n,
            participants: [liveWriter, second],
            balances: [0n, 0n],
            currentTurnIndex: 1n
        });

        expect(await stateMachine.peekNextToWrite(peeked)).to.equal(second);
        expect(await stateMachine.getState()).to.equal(liveState);
        expect(await stateMachine.getNextToWrite()).to.equal(liveWriter);
    });

    it("an undecodable state, so getNextToWriteOf reverts -> rejects with StateMachineInterface.peekNextToWrite: …; getState still returns the live state", async function () {
        const { stateMachine, liveState } = await deployLiveMachine();

        await expect(stateMachine.peekNextToWrite("0x1234")).to.be.rejectedWith(
            /^StateMachineInterface\.peekNextToWrite: /
        );
        expect(await stateMachine.getState()).to.equal(liveState);
    });
});

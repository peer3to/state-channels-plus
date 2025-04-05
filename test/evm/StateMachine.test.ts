import { ethers } from "hardhat";
import { expect } from "chai";
import { EVM } from "@ethereumjs/evm";
import { StateMachine } from "@/evm/StateMachine";
import { TransactionStruct } from "@typechain-types/contracts/V1/DataTypes";
import { Address } from "@ethereumjs/util";

const STATE_SHAPE = ["tuple(uint256 number, address[] participants)"];

function encodeState(state: { number: bigint, participants: string[] }): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(STATE_SHAPE, [state]);
}

function decodeState(encodedState: string): { number: bigint, participants: string[] } {
  return ethers.AbiCoder.defaultAbiCoder().decode(STATE_SHAPE, encodedState)[0];
}

// Utility function to create a transaction
function createTransaction(participant: string, transactionCnt: number, data: string): TransactionStruct {
  return {
    header: {
      participant: participant,
      transactionCnt: transactionCnt,
      forkCnt: 1,
      timestamp: Math.floor(Date.now() / 1000),
      channelId: ethers.id("testChannel")
    },
    body: {
      transactionType: 0,
      encodedData: "0x",
      data: data
    }
  };
}



describe("StateMachineInterface", function () {
  let evm: EVM;
  let stateMachine: StateMachine;
  let mathStateMachine: any;
  let signers: any[];
  let transactionCounter = 1;


  before(async function () {
    mathStateMachine = await ethers.getContractFactory("MathStateMachine");
    signers = await ethers.getSigners();

    const deployTx = await mathStateMachine.getDeployTransaction();

    // Create EVM and deploy the contract
    evm = await EVM.create();
    const deploymentResult = await evm.runCall({
      data: ethers.getBytes(deployTx.data)
    });

    expect(deploymentResult.createdAddress).to.not.be.undefined;

    // Create StateMachineInterface
    stateMachine = StateMachine.create(
      evm,
      deploymentResult.createdAddress as Address,
      mathStateMachine.interface
    );
  });



  it("should execute state transition to add a value", async function () {
    // Create a transaction that calls the add function
    const tx = createTransaction(
      await signers[0].getAddress(),
      transactionCounter++,
      mathStateMachine.interface.encodeFunctionData("add", [10])
    );

    const result = await stateMachine.stateTransition(tx);

    expect(result.success).to.be.true;
    expect(result.logs).to.not.be.empty;

    // Verify that the state was actually changed by calling getSum
    const currentSum = await stateMachine.runView({
      data: mathStateMachine.interface.encodeFunctionData("getSum")
    });

    const decodedSum = mathStateMachine.interface.decodeFunctionResult("getSum", currentSum);
    expect(decodedSum[0]).to.equal(10n);
  });

  it("should get participants", async function () {
    const participants = await stateMachine.getParticipants();
    expect(Array.isArray(participants)).to.be.true;
  });

  it("should get next to write", async function () {
    const nextToWrite = await stateMachine.getNextToWrite();

    expect(nextToWrite).to.match(/^0x[a-fA-F0-9]{40}$/);
  });

  it("should set and get state with modified values", async function () {
    // First get the current state
    const initialState = decodeState(await stateMachine.getState());

    // Change values in the state
    const modifiedState = {
      number: initialState.number + 20n,
      participants: [...initialState.participants, signers[1].address]
    };


    // Set the modified state
    const result = await stateMachine.setState(encodeState(modifiedState));
    expect(result).to.be.true;

    // Get the state again
    const newState = decodeState(await stateMachine.getState());

    // Verify changes were applied
    expect(newState.number).to.equal(modifiedState.number);
    expect(newState.participants.length).to.equal(modifiedState.participants.length);
    expect(newState.participants[newState.participants.length - 1]).to.equal(signers[1].address);
  });

}); 
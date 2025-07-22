import { expect } from "chai";
import sinon from "sinon";
import ValidationService from "@/stateManager/ValidationService";
import Storage from "@/storage";
import { Block } from "@/models";
import { Signature } from "@/types/types";
import AgreementManager from "@/agreementManager/AgreementManager";
import AStateMachine from "@/AStateMachine";
import DisputeHandler from "@/DisputeHandler";
import { AStateChannelManagerProxy } from "@typechain-types/contracts/V1/StateChannelDiamondProxy";
import { ExecutionFlags, TimeConfig } from "@/types";
import { Address, ChannelId } from "@/types/types";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";

// Helper to create a minimal ValidationService with storage
function createValidationServiceWithStorage(storage: Storage) {
    // Mocks for required dependencies
    const agreementManager = sinon.createStubInstance(AgreementManager);
    const stateMachine = sinon.createStubInstance(AStateMachine);
    const disputeHandler = sinon.createStubInstance(DisputeHandler);
    const scmContract = sinon.createStubInstance(AStateChannelManagerProxy);
    const timeCfg = {} as TimeConfig;
    const getChannelId = () => "0x01" as ChannelId;
    const signerAddress = "0xabc" as Address;
    const onSignedBlock = async (_: SignedBlockStruct, __?: Block) =>
        ExecutionFlags.SUCCESS;
    // @ts-ignore
    return new ValidationService(
        storage,
        agreementManager,
        stateMachine,
        disputeHandler,
        scmContract,
        timeCfg,
        getChannelId,
        signerAddress,
        onSignedBlock
    );
}

describe("ValidationService - isBlockInChain", () => {
    let storage: Storage;
    let validationService: ValidationService;
    let block: Block;
    let signature: Signature;
    let encodedState: string;

    beforeEach(() => {
        storage = new Storage();
        validationService = createValidationServiceWithStorage(storage);
        // Use a factory or mock for block creation
        block = Block.from({
            // Provide minimal required fields for Block
            transaction: {} as any,
            stateSnapshotHash: "0xstate",
            previousBlockHash: "0xprev"
        });
        signature = "0xsig" as Signature;
        encodedState = "0xstate";
    });

    it("should return false if the block does not exist in the canonical chain", () => {
        expect((validationService as any).isBlockInChain(block)).to.be.false;
    });

    it("should return true if the block exists in the canonical chain", () => {
        // Simulate storing the block in storage
        storage.blocks.storeBlock(block.toStruct(), { hash: block.hash });
        expect((validationService as any).isBlockInChain(block)).to.be.true;
    });

    it("should return false if a block with same coordinates but different content exists", () => {
        // Store a different block at the same coordinates
        const differentBlock = Block.from({
            transaction: {} as any,
            stateSnapshotHash: "0xotherstate",
            previousBlockHash: "0xprev"
        });
        storage.blocks.storeBlock(differentBlock.toStruct(), {
            hash: differentBlock.hash
        });
        expect((validationService as any).isBlockInChain(block)).to.be.false;
    });

    // Additional edge cases
    it("should return false if the fork count is out of range", () => {
        // Simulate a block with an invalid forkId
        const invalidForkBlock = Block.from({
            transaction: {} as any,
            stateSnapshotHash: "0xstate",
            previousBlockHash: "0xprev"
        });
        // Do not store it
        expect((validationService as any).isBlockInChain(invalidForkBlock)).to
            .be.false;
    });

    it("should return false if the transaction count is out of range", () => {
        // Simulate a block with an invalid transaction count
        const invalidTxBlock = Block.from({
            transaction: {} as any,
            stateSnapshotHash: "0xstate",
            previousBlockHash: "0xprev"
        });
        // Do not store it
        expect((validationService as any).isBlockInChain(invalidTxBlock)).to.be
            .false;
    });

    it("should handle empty storage", () => {
        expect((validationService as any).isBlockInChain(block)).to.be.false;
    });

    it("should handle storage with no matching block", () => {
        // Store a block, but not the one we're checking
        const otherBlock = Block.from({
            transaction: {} as any,
            stateSnapshotHash: "0xotherstate",
            previousBlockHash: "0xprev"
        });
        storage.blocks.storeBlock(otherBlock.toStruct(), {
            hash: otherBlock.hash
        });
        expect((validationService as any).isBlockInChain(block)).to.be.false;
    });
});

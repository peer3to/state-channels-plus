import sinon from "sinon";
import { expect } from "chai";
import {
    container,
    ServiceNames,
    registerEasyServices,
    inject
} from "@/container";
import { ethers } from "hardhat";
import { block } from "../factory";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Address, Bytes } from "@/types/types";

describe("AgreementManager - DI Container Testing Showcase", () => {
    let confirmer: HardhatEthersSigner;
    let mockBlockConfirmation: BlockConfirmationStruct;

    const mockBlock = block();

    before(async () => {
        container.clear();
        registerEasyServices();
        confirmer = (await ethers.getSigners())[1];
        mockBlockConfirmation = {
            signedBlock: {
                encodedBlock: mockBlock.encode(),
                signature: ethers.hexlify(ethers.randomBytes(65))
            },
            signatures: [(await mockBlock.sign(confirmer)) as Bytes]
        };
    });

    afterEach(async () => {
        container.clearMocks();
    });

    it("should use mocked storage and not affect real storage", async () => {
        // Create a mock storage with spy functions
        const mockStorage = {
            blocks: {
                getBlocksByForkId: sinon
                    .stub()
                    .returns([{ blockConfirmation: mockBlockConfirmation }])
            }
        };

        // Get the real storage from container before mocking
        const realStorage = inject(ServiceNames.STORAGE);
        // put mock storage in container
        container.mock(ServiceNames.STORAGE, mockStorage);

        // Resolve AgreementManager - it will use our mocked storage
        const agreementManager = inject(ServiceNames.AGREEMENT_MANAGER);

        // Call a method that uses storage
        const result = agreementManager.getLatestSignedBlockByParticipant(
            mockBlock.forkId,
            confirmer.address
        );

        // Assert the mock was called with correct arguments
        expect(mockStorage.blocks.getBlocksByForkId.calledOnce).to.be.true;
        expect(
            mockStorage.blocks.getBlocksByForkId.calledWith(
                mockBlock.forkId,
                "desc"
            )
        ).to.be.true;

        // Assert we got a result
        expect(result).to.not.be.undefined;
        expect(result?.block.equals(mockBlock)).to.be.true;
        expect(result?.signature).to.equal(mockBlockConfirmation.signatures[0]);

        // Verify the real storage was NOT affected
        const realBlocksAfter = realStorage.blocks.getBlocksByForkId(
            mockBlock.forkId
        );
        expect(realBlocksAfter).to.be.empty;
    });

    it("should use real storage when not mocked", async () => {
        // No mocking - use real storage
        const agreementManager = inject(ServiceNames.AGREEMENT_MANAGER);
        const storage = inject(ServiceNames.STORAGE);

        // Add test data to real storage
        const signature = await mockBlock.sign(confirmer);

        // Store in real storage
        storage.blocks.storeBlockConfirmation(mockBlockConfirmation);

        // Verify storage was modified
        const storedBlocks = storage.blocks.getBlocksByForkId(mockBlock.forkId);
        expect(storedBlocks).to.have.lengthOf(1);

        // Call AgreementManager method
        const result = agreementManager.getLatestSignedBlockByParticipant(
            mockBlock.forkId,
            confirmer.address
        );

        // Assert we got the expected result from real storage
        expect(result).to.not.be.undefined;
        expect(result?.block.equals(mockBlock)).to.be.true;
        expect(result?.signature).to.equal(signature);
    });
});

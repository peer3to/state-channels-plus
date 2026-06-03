import { expect } from "chai";
import { ethers } from "ethers";
import Clock from "@/Clock";
import { Block } from "@/models";
import { FraudProofType } from "@/types/sol-enums";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { MathTestSession as TestSession, sleep } from "@test/harness";
import { decodeMathState } from "@test/utils/mathHarnessAbi";
import type { PeerHandle } from "@test/harness/core/PeerHandle";

/**
 * E2E Tests: Fraud Proofs — onBlockConfirmation (BlockValidationStrategy)
 */

describe("E2E: Block Fraud Proofs", function () {
    it("queued future block accepts later calldata event and executes after predecessor", async function () {
        this.timeout(90000);

        const h = TestSession.getHarness();
        const timeConfig = {
            p2pTime: 3,
            agreementTime: 2,
            chainFallbackTime: 30,
            evidenceTime: 8
        };
        await h.lifecycle.start(4, 0, { timeConfig });

        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;
        // step 1 - stub maybePostBlockOnChain via debug.stubMethod -> works in
        // both inline + worker mode (target[leaf] = fn on the live stateManager).
        for (const peer of h.peerHandles) {
            await h
                .getPeerHandle(peer.index)
                .stub.stubMethod("maybePostBlockOnChain", () => {});
        }

        const observerIndex = 3;
        const observerHandle = h.getPeerHandle(observerIndex);
        const queryObserverSum = async (
            handle: PeerHandle
        ): Promise<bigint> => {
            let stateHash =
                await handle.stateMachine.queryLatestStateMachineStateHash(
                    forkId!
                );
            if (!stateHash) {
                // no blocks yet — fall back to genesis snapshot state
                const genesis = await handle.snapshots.queryGenesisSnapshot(
                    forkId!
                );
                stateHash = genesis?.snapshotData.stateMachineStateHash as
                    | string
                    | undefined;
            }
            const encoded = await handle.stateMachine.queryStateMachineState(
                stateHash!
            );
            return decodeMathState(encoded! as string).number;
        };
        const observerInitialSum = await queryObserverSum(observerHandle);
        await h.network.disconnectPeer(observerIndex);

        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2],
            waitForFinalization: false
        });

        const source = await h.peerWithHighestBlock(forkId!);
        const sourceHandle = h.getPeerHandle(source.index);
        const block1Confirmation =
            await sourceHandle.blocks.queryBlockConfirmationAt({
                forkId: forkId!,
                height: 0
            });
        const block2Confirmation =
            await sourceHandle.blocks.queryBlockConfirmationAt({
                forkId: forkId!,
                height: 1
            });
        expect(block1Confirmation).to.not.be.undefined;
        expect(block2Confirmation).to.not.be.undefined;
        // step 2 - rehydrate orchestrator-side. Block class instances don't
        // survive structured clone -> rebuild via Block.fromBlockConfirmation.
        const block1 = Block.fromBlockConfirmation(
            block1Confirmation!.blockConfirmation as BlockConfirmationStruct,
            block1Confirmation!.onChainTimestamp
        );
        const block2 = Block.fromBlockConfirmation(
            block2Confirmation!.blockConfirmation as BlockConfirmationStruct,
            block2Confirmation!.onChainTimestamp
        );
        expect(
            await observerHandle.blocks.queryNextBlockHeight(forkId!)
        ).to.equal(0);

        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observerIndex,
            blockConfirmation: block2.blockConfirmationStruct,
            keepConnection: true,
            waitForProcessed: false
        });
        expect(
            await observerHandle.blocks.queryBlockByHash(String(block2.hash))
        ).to.be.undefined;

        const postBlockCalldata = async (block: Block) => {
            const author = h.peerHandles.find(
                (peer) =>
                    peer.address.toLowerCase() ===
                    String(block.author).toLowerCase()
            );
            expect(author).to.not.be.undefined;

            await h.getPeerHandle(author!.index).blocks.postBlockCalldata({
                signedBlock: block.signedBlock,
                maxTimestamp: Clock.getTimeInSeconds() + 1000
            });
        };

        h.event.resetEventSpies(observerIndex);
        await postBlockCalldata(block2);
        await h.event.waitUntilEventOccurs("onBlockCalldataPosted", 5000, [
            observerIndex
        ]);
        expect(
            await observerHandle.blocks.queryBlockByHash(String(block2.hash))
        ).to.be.undefined;

        await sleep((timeConfig.agreementTime + 1) * 1000);

        // step 3 - maybePostBlockOnChain is stubbed ()=>{} + after AgreementTime
        // the subjective check each peer does would fail -> if the block is
        // accepted, it took the calldata path.
        await postBlockCalldata(block1);

        await h.eventCountsBarrier.waitFor(
            async () =>
                (await observerHandle.blocks.queryBlockByHash(
                    String(block1.hash)
                )) !== undefined &&
                (await observerHandle.blocks.queryBlockByHash(
                    String(block2.hash)
                )) !== undefined,
            {
                timeoutMs: 5000,
                timeoutMessage:
                    "Queued block did not execute after predecessor calldata event"
            }
        );

        const storedBlock2 = await observerHandle.blocks.queryBlockByHash(
            String(block2.hash)
        );
        expect(storedBlock2?.onChainTimestamp).to.not.be.undefined;
        expect(await queryObserverSum(observerHandle)).to.equal(
            observerInitialSum + 2n
        );
    });

    it("queued duplicate block does not fall through to double sign", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);

        const observer = h.getPeer(0);
        const observerHandle = h.getPeerHandle(observer.index);
        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;

        const latestConfirmation =
            (await observerHandle.blocks.queryLatestBlockConfirmation(
                forkId!
            )) as BlockConfirmationStruct | undefined;
        expect(latestConfirmation).to.not.be.undefined;
        const block = Block.fromBlockConfirmation(latestConfirmation!);

        await observerHandle.blocks.queueBlock({
            blockConfirmation: latestConfirmation!
        });

        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observer.index,
            blockConfirmation: block.blockConfirmationStruct,
            keepConnection: true,
            waitForProcessed: true
        });

        // step 1 - spy reads work in both modes (inline -> sinon.called;
        // worker -> WorkerEventSpy.callCount via mirror). use callCount > 0.
        expect(
            (observer.eventSpies.onInitiatingDispute?.callCount ?? 0) > 0
        ).to.equal(false);
    });

    it("stored duplicate merges trusted timestamp without replaying transition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);

        const observer = h.getPeer(0);
        const observerHandle = h.getPeerHandle(observer.index);
        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;

        const latestConfirmation =
            (await observerHandle.blocks.queryLatestBlockConfirmation(
                forkId!
            )) as BlockConfirmationStruct | undefined;
        expect(latestConfirmation).to.not.be.undefined;
        const block = Block.fromBlockConfirmation(latestConfirmation!);

        const initialNextHeight =
            await observerHandle.blocks.queryNextBlockHeight(forkId!);
        const initialSum =
            observer.contractInstance !== undefined
                ? await observer.contractInstance.getSum()
                : undefined;

        const expectedTimestamp = block.timestamp + 1000;
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observer.index,
            blockConfirmation: {
                signedBlock: block.signedBlock,
                signatures: []
            },
            ingestOptions: { onChainTimestamp: expectedTimestamp },
            keepConnection: true,
            processedKeepConnection: true
        });

        await h.eventCountsBarrier.waitFor(
            async () =>
                (
                    await observerHandle.blocks.queryBlockByHash(
                        String(block.hash)
                    )
                )?.onChainTimestamp === expectedTimestamp,
            {
                timeoutMs: 5000,
                timeoutMessage:
                    "Stored duplicate timestamp was not merged into storage"
            }
        );
        expect(
            await observerHandle.blocks.queryNextBlockHeight(forkId!)
        ).to.equal(initialNextHeight);
        if (observer.contractInstance !== undefined) {
            expect(await observer.contractInstance.getSum()).to.equal(
                initialSum
            );
        }
        const storedBlock = await observerHandle.blocks.queryBlockByHash(
            String(block.hash)
        );
        expect(storedBlock?.onChainTimestamp).to.equal(expectedTimestamp);
    });

    it("stored duplicate rejects a new signature from a non-participant", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);

        const observer = h.getPeer(0);
        const observerHandle = h.getPeerHandle(observer.index);
        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;

        const latestConfirmation =
            (await observerHandle.blocks.queryLatestBlockConfirmation(
                forkId!
            )) as BlockConfirmationStruct | undefined;
        expect(latestConfirmation).to.not.be.undefined;
        const block = Block.fromBlockConfirmation(latestConfirmation!);

        const outsider = ethers.Wallet.createRandom();
        const badSignature = await outsider.signMessage(
            ethers.getBytes(block.hash)
        );
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observer.index,
            blockConfirmation: {
                signedBlock: block.signedBlock,
                signatures: [
                    ...Array.from(block.confirmationSignatures).map(
                        (signature) => String(signature)
                    ),
                    badSignature
                ]
            },
            ingestOptions: { senderAddress: h.getPeer(1).address },
            keepConnection: true,
            processedKeepConnection: false
        });

        expect(
            await observerHandle.channel.isBlacklisted(h.getPeer(1).address)
        ).to.equal(true);
        const storedBlock = await observerHandle.blocks.queryBlockByHash(
            String(block.hash)
        );
        expect(
            storedBlock?.confirmationSignatures.includes(badSignature)
        ).to.equal(false);
    });

    it("double sign → BlockDoubleSign", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);
        const maliciousPeerIndex = 1;
        await h.byzantine.submitDoubleSignBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockDoubleSign,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("wrong genesis → WrongGenesis", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);

        // Peer 2 submits a competing block at height 0 with a wrong previousBlockHash.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitWrongGenesisBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.WrongGenesis,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("unexpected next leader → BlockInvalidStateTransition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);

        const maliciousPeerIndex = 1; // NOT the expected next leader
        await h.byzantine.submitUnexpectedNextLeaderBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("invalid timestamp → InvalidTimestamp", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);

        // Peer 2 submits a block with a timestamp before the previous block's
        // timestamp → objectiveInvalidTimestampDetected → InvalidTimestamp.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitInvalidTimestampBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.InvalidTimestamp,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("broken inbound chain → BlockInvalidStateTransition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);

        // Peer 2 submits a block that includes a messageBlock whose
        // previousBlockHash does not chain from the stored inbound state
        // → findBrokenInboundMessageChainBlock fires after validateBlockConfirmation
        // succeeds → invalidStateTransitionDetected → BlockInvalidStateTransition.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitBrokenInboundChainBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("forged inbound message → ForgedInboundMessageBlock", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);

        // Peer 2 submits a block that contains a fabricated inbound message
        // block that was never actually sent by any peer
        // → detectForgedInboundMessageBlock fires → forgedInboundMessageBlockDetected
        // → ForgedInboundMessageBlock.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitForgedInboundMessageBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.ForgedInboundMessageBlock,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("applyTransaction failure → BlockInvalidStateTransition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);

        // Peer 2 submits a block whose transaction body is malformed data that
        // the contract rejects; applyTransaction returns success=false
        // → invalidStateTransitionDetected → BlockInvalidStateTransition.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitInvalidTransactionDataBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("stateSnapshotHash mismatch → BlockInvalidStateTransition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);

        // Peer 2 submits a block with a valid transaction but a wrong
        // stateSnapshotHash (ZeroHash).
        const maliciousPeerIndex = 2;
        await h.byzantine.submitInvalidStateTransitionBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        await h.assert.storage.storedDisputeConfirmationsWait();

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });
});

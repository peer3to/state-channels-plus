import { expect } from "chai";
import { ethers } from "ethers";
import Clock from "@/Clock";
import { FraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession, sleep } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import type { BlockBundle } from "@test/fixtures/customRpc/harnessControl/services/query/QueryRpcMethods";

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
        // Suppress every peer posting its own block on-chain (forces the
        // calldata path).
        await Promise.all(
            h.peers.map((peer) =>
                h
                    .control(peer)
                    .stub.stubSuppressMaybePostBlockOnChain()
                    .request()
            )
        );

        const observerIndex = 3;
        const observer = h.getPeer(observerIndex);
        await h.network.disconnectPeer(observerIndex);
        const observerInitialSum = await observer.contractInstance.getSum();

        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2],
            waitForFinalization: false
        });

        const source = await h.peerWithHighestBlock(forkId!);
        const block1 = await h
            .control(source)
            .query.getBlockByHeight(forkId!, 0)
            .request();
        const block2 = await h
            .control(source)
            .query.getBlockByHeight(forkId!, 1)
            .request();
        expect(block1).to.not.be.null;
        expect(block2).to.not.be.null;
        expect(
            Number(
                await h
                    .control(observer)
                    .query.getNextBlockHeight(forkId!)
                    .request()
            )
        ).to.equal(0);

        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observerIndex,
            blockConfirmation: Codec.decode(
                block2!.encodedBlockConfirmation,
                Type.BlockConfirmation
            ),
            keepConnection: true,
            waitForProcessed: false
        });
        expect(
            await h
                .control(observer)
                .query.getBlockByHash(block2!.hash)
                .request()
        ).to.be.null;

        // Posts the block's calldata on-chain via the author's host-backed SCM
        // and returns the mined block's timestamp — what an event (re)read
        // would deliver as onChainTimestamp.
        const postBlockCalldata = async (block: BlockBundle) => {
            const author = h.peers.find(
                (peer) =>
                    peer.address.toLowerCase() === block.author.toLowerCase()
            );
            expect(author).to.not.be.undefined;

            const tx =
                await author!.p2pInstance.stateChannelManagerContract.postBlockCalldata(
                    Codec.decode(block.encodedSignedBlock, Type.SignedBlock),
                    Clock.getTimeInSeconds() + 1000
                );
            const receipt = await tx.wait();
            const minedBlock = await h.provider.getBlock(receipt!.blockNumber);
            return Number(minedBlock!.timestamp);
        };

        h.event.resetEventSpies(observerIndex);
        const block2OnChainTimestamp = await postBlockCalldata(block2!);
        await h.event.waitUntilEventOccurs("onBlockCalldataPosted", 5000, [
            observerIndex
        ]);
        expect(
            await h
                .control(observer)
                .query.getBlockByHash(block2!.hash)
                .request()
        ).to.be.null;

        await sleep((timeConfig.agreementTime + 1) * 1000);

        // The future calldata copy was evicted at the queue timeout — the
        // chain still holds it, so nothing is lost.
        expect(
            await h
                .control(observer)
                .query.isBlockQueued(block2!.hash)
                .request()
        ).to.equal(false);

        // maybePostBlockOnChain is stubbed ()=>{} + after AgreementTime the subjective check each peer does would fail, so if the block is accepted -> calldata path
        await postBlockCalldata(block1!);

        await waitFor(
            async () =>
                (await h
                    .control(observer)
                    .query.getBlockByHash(block1!.hash)
                    .request()) !== null,
            5000
        );

        // Re-deliver block2 from the chain (as an event re-read would) — it
        // is next now and applies through the calldata path.
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observerIndex,
            blockConfirmation: Codec.decode(
                block2!.encodedBlockConfirmation,
                Type.BlockConfirmation
            ),
            ingestOptions: { onChainTimestamp: block2OnChainTimestamp },
            keepConnection: true,
            waitForProcessed: false
        });
        await waitFor(
            async () =>
                (await h
                    .control(observer)
                    .query.getBlockByHash(block2!.hash)
                    .request()) !== null,
            5000
        );

        const storedBlock2 = await h
            .control(observer)
            .query.getBlockByHash(block2!.hash)
            .request();
        expect(storedBlock2?.onChainTimestamp).to.not.be.null;
        expect(await observer.contractInstance.getSum()).to.equal(
            observerInitialSum + 2n
        );
    });

    it("queued duplicate block does not fall through to double sign", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);

        const observer = h.getPeer(0);
        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;

        const block = await h
            .control(observer)
            .query.getLatestBlockBundle(forkId!)
            .request();
        expect(block).to.not.be.null;

        // One-off white-box mutation: queue the latest block host-side.
        await h.execOnHost(
            observer,
            (sm, args) => {
                const latest = sm.storage.blocks.getLatestBlock(args.forkId);
                if (!latest) throw new Error("no latest block to queue");
                sm.storage.queues.queueBlock(latest);
            },
            { forkId: forkId! }
        );

        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observer.index,
            blockConfirmation: Codec.decode(
                block!.encodedBlockConfirmation,
                Type.BlockConfirmation
            ),
            keepConnection: true,
            waitForProcessed: true
        });

        expect(observer.eventSpies.onInitiatingDispute!.called).to.equal(false);
    });

    it("stored duplicate merges trusted timestamp without replaying transition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);

        const observer = h.getPeer(0);
        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;

        const block = await h
            .control(observer)
            .query.getLatestBlockBundle(forkId!)
            .request();
        expect(block).to.not.be.null;

        const initialNextHeight = Number(
            await h
                .control(observer)
                .query.getNextBlockHeight(forkId!)
                .request()
        );
        const initialSum = await observer.contractInstance.getSum();

        const expectedTimestamp = block!.timestamp + 1000;
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observer.index,
            blockConfirmation: {
                signedBlock: Codec.decode(
                    block!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: []
            },
            ingestOptions: { onChainTimestamp: expectedTimestamp },
            keepConnection: true,
            processedKeepConnection: true
        });

        await waitFor(
            async () =>
                (
                    await h
                        .control(observer)
                        .query.getBlockByHash(block!.hash)
                        .request()
                )?.onChainTimestamp === expectedTimestamp,
            5000
        );
        expect(
            Number(
                await h
                    .control(observer)
                    .query.getNextBlockHeight(forkId!)
                    .request()
            )
        ).to.equal(initialNextHeight);
        expect(await observer.contractInstance.getSum()).to.equal(initialSum);
        expect(
            (
                await h
                    .control(observer)
                    .query.getBlockByHash(block!.hash)
                    .request()
            )?.onChainTimestamp
        ).to.equal(expectedTimestamp);
    });

    it("stored duplicate drops a new signature from a non-participant without dropping the block", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);

        const observer = h.getPeer(0);
        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;

        const block = await h
            .control(observer)
            .query.getLatestBlockBundle(forkId!)
            .request();
        expect(block).to.not.be.null;

        const outsider = ethers.Wallet.createRandom();
        const badSignature = await outsider.signMessage(
            ethers.getBytes(block!.hash)
        );
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observer.index,
            blockConfirmation: {
                signedBlock: Codec.decode(
                    block!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: [...block!.confirmationSignatures, badSignature]
            },
            ingestOptions: { senderAddress: h.getPeer(1).address },
            keepConnection: true,
            // The merge is a scheduled task and setup echoes of this block
            // fire matching processed events, so waiting on the event races —
            // poll for the strategy's outcome (sender blacklisted) instead.
            waitForProcessed: false
        });

        await waitFor(
            async () =>
                await h
                    .control(observer)
                    .query.isBlacklisted(h.getPeer(1).address)
                    .request(),
            5000
        );
        const storedBlock = await h
            .control(observer)
            .query.getBlockByHash(block!.hash)
            .request();
        expect(
            storedBlock?.confirmationSignatures.includes(badSignature)
        ).to.equal(false);
    });

    it("fresh block with a non-participant signature applies after dropping it", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);

        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;

        // Keep the observer blind to the next block so it can be hand-fed a
        // tainted copy of it.
        const observerIndex = 3;
        const observer = h.getPeer(observerIndex);
        await h.network.disconnectPeer(observerIndex);
        const observerInitialSum = await observer.contractInstance.getSum();

        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2],
            waitForFinalization: false
        });

        const source = await h.peerWithHighestBlock(forkId!);
        const block = await h
            .control(source)
            .query.getBlockByHeight(forkId!, 0)
            .request();
        expect(block).to.not.be.null;

        const outsider = ethers.Wallet.createRandom();
        const badSignature = await outsider.signMessage(
            ethers.getBytes(block!.hash)
        );
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observerIndex,
            blockConfirmation: {
                signedBlock: Codec.decode(
                    block!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: [...block!.confirmationSignatures, badSignature]
            },
            ingestOptions: { senderAddress: h.getPeer(1).address },
            keepConnection: true,
            // The block applies; the byzantine signature suppliers are
            // disconnected+blacklisted by the strategy directly.
            processedKeepConnection: true
        });

        // The block applied normally — stray signature dropped, not the block.
        const storedBlock = await h
            .control(observer)
            .query.getBlockByHash(block!.hash)
            .request();
        expect(storedBlock).to.not.be.null;
        expect(
            storedBlock!.confirmationSignatures.includes(badSignature)
        ).to.equal(false);
        expect(await observer.contractInstance.getSum()).to.equal(
            observerInitialSum + 1n
        );
        // The peer that supplied the stray signature is cut.
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(h.getPeer(1).address)
                .request()
        ).to.equal(true);
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
        const honestPeers = h.peers.filter(
            (p) => p.index !== maliciousPeerIndex
        );
        const honestSumsBefore = await Promise.all(
            honestPeers.map((p) => p.contractInstance.getSum())
        );
        await h.byzantine.submitInvalidStateTransitionBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        // The block's add() executed on honest VMs before the snapshot-hash
        // check failed; the abort must have rolled the state back.
        for (let i = 0; i < honestPeers.length; i++) {
            expect(
                await honestPeers[i].contractInstance.getSum(),
                `Peer ${honestPeers[i].index} VM state not restored after rejected block`
            ).to.equal(honestSumsBefore[i]);
        }

        await h.assert.storage.storedDisputeConfirmationsWait();

        await h.dispute.resolveDisputeWait();
        await h.assert.sync.onlyHonestPeersInSync();
    });
});

import { expect } from "chai";
import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { BlockValidationResult, Status } from "@/types";
import {
    MathTestSession as TestSession,
    MIN_TEST_TIME_CONFIG
} from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import * as factory from "@test/factory";
import type { Address } from "@/types/types";

/**
 * Unit-scope harness tests for BlockQueueManager's ingest guards and the
 * queue-timeout stored-merge branch. Real sessions, real blocks, real
 * signatures — the component is poked host-side through the control RPC.
 */

describe("E2E: BlockQueueManager", function () {
    it("ingest rejects a block confirmation with a forged author signature", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);

        const forkId = h.activeForkId;
        expect(forkId).to.not.be.undefined;

        const observer = h.getPeer(0);
        const bundle = await h
            .control(observer)
            .query.getLatestBlockBundle(forkId!)
            .request();
        expect(bundle).to.not.be.null;

        // Same block bytes, but the author signature recovers to an outsider
        // instead of header.participant — authentication must fail.
        const signedBlock = Codec.decode(
            bundle!.encodedSignedBlock,
            Type.SignedBlock
        );
        const outsider = ethers.Wallet.createRandom();
        const forgedSignature = await outsider.signMessage(
            ethers.getBytes(bundle!.hash)
        );

        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observer.index,
            blockConfirmation: {
                signedBlock: {
                    encodedBlock: signedBlock.encodedBlock,
                    signature: forgedSignature
                },
                signatures: []
            },
            keepConnection: false
        });

        const storedBlock = await h
            .control(observer)
            .query.getBlockByHash(bundle!.hash)
            .request();
        expect(storedBlock).to.not.be.null;
        expect(storedBlock!.confirmationSignatures).to.deep.equal(
            bundle!.confirmationSignatures
        );
        expect(
            storedBlock!.confirmationSignatures.includes(forgedSignature)
        ).to.equal(false);
    });

    it("ingest drops a wrong-channel block and cuts the transport when the sender is known", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);

        const observer = h.getPeer(0);

        // An authentic block (author signature recovers to header.participant)
        // for a channel this peer is not in.
        const outsider = ethers.Wallet.createRandom();
        const foreignBlock = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    channelId: ethers.hexlify(ethers.randomBytes(32)),
                    participant: outsider.address as Address
                })
            })
        });
        const blockConfirmation = {
            signedBlock: {
                encodedBlock: foreignBlock.encode(),
                signature: await outsider.signMessage(
                    ethers.getBytes(foreignBlock.hash)
                )
            },
            signatures: []
        };

        // Without a known sender the block is just ignored.
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observer.index,
            blockConfirmation,
            keepConnection: true,
            waitForProcessed: false
        });

        // Sent over the real state-transition RPC, the observer rejects it
        // and cuts + blacklists the sending transport.
        const sender = h.getPeer(1);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(sender.address)
                .request()
        ).to.equal(false);
        await h
            .control(sender)
            .byzantine.sendBlockConfirmation(
                Codec.encode(
                    blockConfirmation,
                    Type.BlockConfirmation
                ) as string,
                observer.address
            )
            .request();

        await waitFor(
            async () =>
                await h
                    .control(observer)
                    .query.isBlacklisted(sender.address)
                    .request(),
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await h
                .control(observer)
                .query.isConnectedTo(sender.address)
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(observer)
                .query.getBlockByHash(foreignBlock.hash)
                .request()
        ).to.be.null;
    });
    it("ingest cuts both the relayer and the author of an outsider-authored block", async function () {
        const h = TestSession.getHarness();
        // short windows so the two spectators converge on the victim inside the
        // connection barrier below
        await h.lifecycle.start(3, 1, {
            timeConfig: { ...MIN_TEST_TIME_CONFIG, chainFallbackTime: 12 }
        });
        const forkId = h.activeForkId!;

        const victim = h.getPeer(0);
        expect(
            await h.control(victim).query.getStatus().request(),
            "victim is an active participant"
        ).to.equal(Status.PARTICIPATING);

        // two connected non-participants: one authors, the other relays
        const author = await h.join.addSpectator();
        const relayer = await h.join.addSpectator();
        await h.connectionBarrier.waitFor(
            async () =>
                (await h
                    .control(relayer)
                    .query.isConnectedTo(victim.address)
                    .request()) &&
                (await h
                    .control(author)
                    .query.isConnectedTo(victim.address)
                    .request()),
            {
                timeoutMs: h.event.protocolEventTimeoutMs(),
                timeoutMessage: "relayer/author never both connected to victim"
            }
        );

        h.event.resetEventSpies();

        const { encodedBlockConfirmation } =
            await h.byzantine.craftOutsiderAuthoredBlockConfirmation(
                victim.index,
                forkId,
                author.signer
            );
        await h
            .control(relayer)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                victim.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: relayer,
            expectedStatus: Status.PARTICIPATING
        });
        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: author,
            expectedStatus: Status.PARTICIPATING
        });
        h.assert.dispute.noDisputes();
    });

    it("future block is evicted at queue timeout without punishing the supplier", async function () {
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

        const observerIndex = 3;
        const observer = h.getPeer(observerIndex);
        await h.network.blacklistAndDisconnectPeer(observerIndex);

        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2],
            waitForFinalization: false
        });

        const source = await h.peerWithHighestBlock(forkId!);
        const block1 = await h
            .control(source)
            .query.getBlockByHeight(forkId!, 1)
            .request();
        expect(block1).to.not.be.null;
        const supplier = h.getPeer(1);
        // Isolation blacklisted observer→all peers. Restore only supplier 1
        // so this test can observe whether queue eviction punishes it.
        expect(
            await h
                .control(observer)
                .network.unblacklistPeerByAddress(supplier.address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(supplier.address)
                .request()
        ).to.equal(false);
        const restoreSync = await h.rpcStub.recordSpectateSync(observerIndex, {
            forward: false
        });
        // Future block (height 1 > observer's nextHeight 0) queues.
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observerIndex,
            blockConfirmation: Codec.decode(
                block1!.encodedBlockConfirmation,
                Type.BlockConfirmation
            ),
            ingestOptions: { senderAddress: supplier.address },
            keepConnection: true,
            waitForProcessed: false
        });
        expect(
            await h
                .control(observer)
                .query.isBlockQueued(block1!.hash)
                .request()
        ).to.equal(true);

        // Once the agreement window lapses the entry is evicted. The record-only
        // sync probe keeps separate recovery-failure punishment out of scope.
        await waitFor(
            async () =>
                !(await h
                    .control(observer)
                    .query.isBlockQueued(block1!.hash)
                    .request()),
            (timeConfig.agreementTime + 5) * 1000
        );
        expect(
            await h
                .control(observer)
                .query.getBlockByHash(block1!.hash)
                .request()
        ).to.be.null;
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(supplier.address)
                .request()
        ).to.equal(false);
        await restoreSync();
    });

    it("queued entry that becomes stored merges at queue timeout: strays stripped, supplier blacklisted", async function () {
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

        // Keep the observer blind so the block stays queued as a future block.
        const observerIndex = 3;
        const observer = h.getPeer(observerIndex);
        await h.network.blacklistAndDisconnectPeer(observerIndex);

        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2],
            waitForFinalization: false
        });

        const source = await h.peerWithHighestBlock(forkId!);
        const block1 = await h
            .control(source)
            .query.getBlockByHeight(forkId!, 1)
            .request();
        expect(block1).to.not.be.null;
        // Isolation blacklisted observer→all peers. Restore only peer 1 so
        // the bad-signature path, not harness setup, owns its later blacklist.
        expect(
            await h
                .control(observer)
                .network.unblacklistPeerByAddress(h.getPeer(1).address)
                .request()
        ).to.equal(true);

        // Tainted copy of h1 queues (height 1 > observer's nextHeight 0) with
        // the stray signature attributed to its supplier.
        const outsider = ethers.Wallet.createRandom();
        const badSignature = await outsider.signMessage(
            ethers.getBytes(block1!.hash)
        );
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: observerIndex,
            blockConfirmation: {
                signedBlock: Codec.decode(
                    block1!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: [...block1!.confirmationSignatures, badSignature]
            },
            ingestOptions: { senderAddress: h.getPeer(1).address },
            keepConnection: true,
            waitForProcessed: false
        });
        expect(
            await h
                .control(observer)
                .query.getBlockByHash(block1!.hash)
                .request()
        ).to.be.null;

        // The block becomes stored out-of-band (as state-proof persistence
        // does) while the entry still sits in the queue — the queue timeout
        // must merge it immediately with the entry's attribution intact.
        await h
            .control(observer)
            .transition.storeBlock(block1!.encodedBlockConfirmation)
            .request();

        await waitFor(
            async () =>
                await h
                    .control(observer)
                    .query.isBlacklisted(h.getPeer(1).address)
                    .request(),
            (timeConfig.agreementTime + 5) * 1000
        );
        const storedBlock = await h
            .control(observer)
            .query.getBlockByHash(block1!.hash)
            .request();
        expect(storedBlock).to.not.be.null;
        expect(
            storedBlock!.confirmationSignatures.includes(badSignature)
        ).to.equal(false);
    });

    describe("wrong-fork blocks", function () {
        const forkTimeConfig = {
            p2pTime: 3,
            agreementTime: 4,
            chainFallbackTime: 2,
            evidenceTime: 3
        };

        it("recovers the first reduced-fork block by reducing locally at ingest", async function () {
            const h = TestSession.getHarness();
            const targetPeerIndex = 1;
            const maliciousPeerIndex = 2;
            const reducingHonestPeers = [0, 3];

            // 2 = warm-up transitions the dispute staging needs, not the peer index.
            await h.lifecycle.start(4, 2, {
                timeConfig: forkTimeConfig
            });
            await h.assert.sync.peersInSyncWait();

            const originalForkId = h.activeForkId!;
            const targetPeer = h.getPeer(targetPeerIndex);

            const race = await h.rpcStub.holdReductionRace(targetPeerIndex);

            h.event.resetEventSpies();
            const { newForkId } = await h.scenario.disputeAndResolve({
                maliciousPeerIndex,
                forkId: originalForkId,
                honestPeerIndices: reducingHonestPeers,
                resetEventSpies: false
            });

            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(
                0,
                "target peer should not reduce before the first-block race"
            );
            expect(
                await h.control(targetPeer).query.getForkId().request()
            ).to.equal(originalForkId);

            // The reduced-snapshot event must be held (staged race) before
            // the first-block delivery.
            await waitFor(
                async () => (await race.heldSnapshotEventCount()) > 0,
                h.event.protocolEventTimeoutMs(),
                50
            );

            const sourcePeer = h.getPeer(reducingHonestPeers[0]);
            const nextWriterAddress = await h
                .control(sourcePeer)
                .query.getNextToWrite()
                .request();
            const writerPeer = h.peers.find(
                (p) => p.address === nextWriterAddress
            );
            // Not `.equal(undefined)`: hardhat-chai-matchers probes .equal
            // operands with ethers getAddress, and a failed probe stringifies
            // the whole TestPeer graph (contract proxies included) into the
            // discarded error - a multi-second main-thread stall.
            expect(writerPeer, "no writer peer found").to.not.be.undefined;
            expect(writerPeer!.index).not.to.equal(
                targetPeerIndex,
                "test setup requires a different peer to write the first reduced-fork block"
            );

            await writerPeer!.p2pInstance.p2pContractInstance.add(1);

            await waitFor(async () => {
                const block = await h
                    .control(sourcePeer)
                    .query.getBlockByHeight(newForkId, 0)
                    .request();
                return Boolean(block?.encodedBlockConfirmation);
            }, h.event.protocolEventTimeoutMs());

            const firstBlock = await h
                .control(sourcePeer)
                .query.getBlockByHeight(newForkId, 0)
                .request();
            expect(firstBlock).not.to.equal(null);

            // The wrong-fork gate sees a disputed current fork, reduces
            // locally in place and accepts the block on the reduced fork.
            await h.transition.ingestBlockConfirmationWait({
                peerIndex: targetPeerIndex,
                blockConfirmation: Codec.decode(
                    firstBlock!.encodedBlockConfirmation,
                    Type.BlockConfirmation
                ),
                ingestOptions: {
                    senderAddress: writerPeer!.address
                },
                keepConnection: true,
                processedKeepConnection: true
            });

            await waitFor(
                async () =>
                    (await h
                        .control(targetPeer)
                        .query.getForkId()
                        .request()) === newForkId,
                h.event.protocolEventTimeoutMs()
            );
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(1, "ingest-time local reduction should set state once");
            expect(
                await h
                    .control(targetPeer)
                    .query.getBlockByHeight(newForkId, 0)
                    .request()
            ).to.not.equal(
                null,
                "target peer should store the reduced-fork block"
            );

            await race.release();

            await h.event.waitWhileEventCountsStayAtMost(
                "onSetState",
                [targetPeerIndex],
                { durationMs: 2000, maxCount: 1 }
            );
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(1, "replayed snapshot events must not set state again");

            const expectedSum = await h
                .getPeer(reducingHonestPeers[0])
                .contractInstance.getSum();
            expect(
                await h.getPeer(targetPeerIndex).contractInstance.getSum()
            ).to.equal(
                expectedSum,
                "target peer state must converge with the reducing peers"
            );
        });

        it("queues an unknown-fork block for sync; the failed sync, not the queue, punishes the supplier", async function () {
            const h = TestSession.getHarness();
            const timeConfig = {
                p2pTime: 3,
                // 4, not 2: the immediate isBlockQueued check below must not
                // race the entry's own eviction timer under parallel-load stall.
                agreementTime: 4,
                chainFallbackTime: 30,
                evidenceTime: 8
            };
            await h.lifecycle.start(3, 0, { timeConfig });

            const observer = h.getPeer(0);
            const originalForkId = await h
                .control(observer)
                .query.getForkId()
                .request();

            const observerStatus = await h
                .control(observer)
                .query.getStatus()
                .request();

            // Record (and forward) sync requests + reduction attempts.
            const restoreSync = await h.rpcStub.recordSpectateSync(0, {
                forward: true
            });
            const restoreReduce = await h.rpcStub.recordReduce(0);

            const author = h.getPeer(1);
            const { bogusBlock, blockConfirmation } =
                await h.byzantine.craftBogusForkBlockZero(author.index);

            await h.transition.ingestBlockConfirmationWait({
                peerIndex: observer.index,
                blockConfirmation,
                ingestOptions: { senderAddress: author.address },
                keepConnection: true,
                waitForProcessed: false
            });

            // Queued unscheduled: the pipeline never ran, and there is NO
            // arrival-time sync - the queue timeout is the sole sync probe now.
            expect(
                await h
                    .control(observer)
                    .query.isBlockQueued(bogusBlock.hash)
                    .request()
            ).to.equal(true);
            expect(await h.rpcStub.spectateSyncCallCount(0)).to.equal(0);
            // Current fork is not disputed - no reduction probe fired.
            expect(await h.rpcStub.reduceCallCount(0)).to.equal(0);
            expect(
                await h.control(observer).query.getForkId().request()
            ).to.equal(originalForkId);
            expect(
                await h
                    .control(observer)
                    .query.getBlockByHash(bogusBlock.hash)
                    .request()
            ).to.be.null;

            // Punishment arrives through the sync flow, not the queue: the
            // supplier cannot prove the fork, so the failed sync blacklists them.
            // `queueTimeout` removes the block before it issues that sync probe,
            // so once the blacklist lands the eviction has already happened -
            // asserted synchronously below.
            await h.assert.rpc.peerBlacklistedAndDisconnected({
                observer,
                target: author,
                expectedStatus: observerStatus
            });
            expect(
                await h
                    .control(observer)
                    .query.isBlockQueued(bogusBlock.hash)
                    .request(),
                "bogus block still queued after the deadline"
            ).to.equal(false);
            expect(
                await h
                    .control(observer)
                    .query.getBlockByHash(bogusBlock.hash)
                    .request()
            ).to.be.null;
            expect(
                await h.control(observer).query.getForkId().request()
            ).to.equal(originalForkId);

            await restoreSync();
            await restoreReduce();
        });

        // Supplier != author, so the recorded targets separate them: the timeout
        // asks everyone the entry is attributed to, not just the sender.
        it("unknown-fork timeout asks both the supplier and the author to sync", async function () {
            const h = TestSession.getHarness();
            const timeConfig = {
                p2pTime: 3,
                agreementTime: 4,
                chainFallbackTime: 30,
                evidenceTime: 8
            };
            await h.lifecycle.start(3, 0, { timeConfig });

            const observer = h.getPeer(0);
            const author = h.getPeer(1);
            const supplier = h.getPeer(2);

            const restoreSync = await h.rpcStub.recordSpectateSync(0, {
                forward: false
            });

            const { bogusBlock, blockConfirmation } =
                await h.byzantine.craftBogusForkBlockZero(author.index);
            await h.transition.ingestBlockConfirmationWait({
                peerIndex: observer.index,
                blockConfirmation,
                ingestOptions: { senderAddress: supplier.address },
                keepConnection: true,
                waitForProcessed: false
            });
            expect(
                await h
                    .control(observer)
                    .query.isBlockQueued(bogusBlock.hash)
                    .request()
            ).to.equal(true);

            // the record stub releases this once the queue timeout has asked
            // both - a signal, not a poll. members, not a set: same addresses in
            // any order, and a peer asked twice would fail on the extra entry
            expect(
                await h.rpcStub.spectateSyncTargetsWait(
                    0,
                    2,
                    (timeConfig.agreementTime + 20) * 1000
                )
            ).to.have.members([supplier.address, author.address]);

            await restoreSync();
        });

        it("unknown fork: both the supplier and the author are asked and both are cut", async function () {
            const h = TestSession.getHarness();
            const timeConfig = {
                p2pTime: 3,
                agreementTime: 4,
                chainFallbackTime: 30,
                evidenceTime: 8
            };
            await h.lifecycle.start(3, 0, { timeConfig });

            const observer = h.getPeer(0);
            const author = h.getPeer(1);
            const supplier = h.getPeer(2);
            const originalForkId = await h
                .control(observer)
                .query.getForkId()
                .request();
            const observerStatus = await h
                .control(observer)
                .query.getStatus()
                .request();

            const { blockConfirmation } =
                await h.byzantine.craftBogusForkBlockZero(author.index);
            await h.transition.ingestBlockConfirmationWait({
                peerIndex: observer.index,
                blockConfirmation,
                ingestOptions: { senderAddress: supplier.address },
                keepConnection: true,
                waitForProcessed: false
            });

            await h.assert.rpc.peerBlacklistedAndDisconnected({
                observer,
                target: supplier,
                expectedStatus: observerStatus
            });
            await h.assert.rpc.peerBlacklistedAndDisconnected({
                observer,
                target: author,
                expectedStatus: observerStatus
            });
            expect(
                await h.control(observer).query.getForkId().request()
            ).to.equal(originalForkId);
        });

        it("still recovers via local reduction when the raced block is on yet another unknown fork", async function () {
            const h = TestSession.getHarness();
            const targetPeerIndex = 1;
            const maliciousPeerIndex = 2;
            const reducingHonestPeers = [0, 3];

            // 2 = warm-up transitions the dispute staging needs, not the peer index.
            await h.lifecycle.start(4, 2, {
                timeConfig: forkTimeConfig
            });
            await h.assert.sync.peersInSyncWait();

            const originalForkId = h.activeForkId!;
            const targetPeer = h.getPeer(targetPeerIndex);

            const race = await h.rpcStub.holdReductionRace(targetPeerIndex);

            h.event.resetEventSpies();
            const { newForkId } = await h.scenario.disputeAndResolve({
                maliciousPeerIndex,
                forkId: originalForkId,
                honestPeerIndices: reducingHonestPeers,
                resetEventSpies: false
            });

            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(0, "target peer should not reduce before the race");

            // Not the reduced-fork block: an authentic block-0 on a fork
            // nobody has. The mismatch still triggers the local reduction
            // (the current fork is disputed), but the block itself must be
            // quarantined for sync, not accepted.
            const author = h.getPeer(reducingHonestPeers[0]);
            const { bogusBlock, blockConfirmation } =
                await h.byzantine.craftBogusForkBlockZero(author.index);

            await h.transition.ingestBlockConfirmationWait({
                peerIndex: targetPeerIndex,
                blockConfirmation,
                ingestOptions: { senderAddress: author.address },
                keepConnection: true,
                waitForProcessed: false
            });

            // Gate on onSetState, not getForkId: unsafeSetLatestState sets
            // this.forkId ~2 awaits before it fires onSetState, so waiting on
            // the fork id lets the count assertion race in and read 0.
            await h.event.waitForEventCounts(
                "onSetState",
                [{ peerId: targetPeerIndex, expectedCount: 1 }],
                10000
            );
            expect(
                await h.control(targetPeer).query.getForkId().request()
            ).to.equal(
                newForkId,
                "the local reduction should land the target on the reduced fork"
            );
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(
                1,
                "the wrong-fork block should trigger exactly one local reduction"
            );

            // The bogus block sits queued for sync until eviction - never
            // validated, never stored.
            expect(
                await h
                    .control(targetPeer)
                    .query.isBlockQueued(bogusBlock.hash)
                    .request()
            ).to.equal(true);
            await waitFor(
                async () =>
                    !(await h
                        .control(targetPeer)
                        .query.isBlockQueued(bogusBlock.hash)
                        .request()),
                (forkTimeConfig.agreementTime + 5) * 1000
            );
            expect(
                await h
                    .control(targetPeer)
                    .query.getBlockByHash(bogusBlock.hash)
                    .request()
            ).to.be.null;
            // The supplier cannot prove the bogus fork - the failed sync
            // blacklists them.
            await waitFor(
                async () =>
                    await h
                        .control(targetPeer)
                        .query.isBlacklisted(author.address)
                        .request(),
                h.event.protocolEventTimeoutMs()
            );

            await race.release();
            await h.event.waitWhileEventCountsStayAtMost(
                "onSetState",
                [targetPeerIndex],
                { durationMs: 2000, maxCount: 1 }
            );
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(1, "replayed snapshot events must not set state again");
        });

        it("drains an early reduced-fork block once the fork transition catches up", async function () {
            const h = TestSession.getHarness();
            const targetPeerIndex = 1;
            const maliciousPeerIndex = 2;
            const reducingHonestPeers = [0, 3];

            // 2 = warm-up transitions the dispute staging needs, not the peer index.
            await h.lifecycle.start(4, 2, {
                // Long queue window: the early block must survive queued
                // until the release below drains it.
                timeConfig: { ...forkTimeConfig, agreementTime: 10 }
            });
            await h.assert.sync.peersInSyncWait();

            const originalForkId = h.activeForkId!;
            const targetPeer = h.getPeer(targetPeerIndex);

            const race = await h.rpcStub.holdReductionRace(targetPeerIndex);
            // Simulate "kill period not expired yet": the ingest-time
            // recovery finds nothing to reduce and must queue for sync. The
            // sync flow itself stays quiet - this test isolates the
            // queue-drain-after-transition property.
            const restoreReduce = await h.rpcStub.reduceNoop(targetPeerIndex);
            const restoreSync = await h.rpcStub.recordSpectateSync(
                targetPeerIndex,
                { forward: false }
            );

            h.event.resetEventSpies();
            const { newForkId } = await h.scenario.disputeAndResolve({
                maliciousPeerIndex,
                forkId: originalForkId,
                honestPeerIndices: reducingHonestPeers,
                resetEventSpies: false
            });

            const sourcePeer = h.getPeer(reducingHonestPeers[0]);
            const nextWriterAddress = await h
                .control(sourcePeer)
                .query.getNextToWrite()
                .request();
            const writerPeer = h.peers.find(
                (p) => p.address === nextWriterAddress
            );
            // See the recovery test: no `.equal(undefined)` on a TestPeer.
            expect(writerPeer, "no writer peer found").to.not.be.undefined;
            expect(writerPeer!.index).not.to.equal(targetPeerIndex);

            await writerPeer!.p2pInstance.p2pContractInstance.add(1);

            await waitFor(async () => {
                const block = await h
                    .control(sourcePeer)
                    .query.getBlockByHeight(newForkId, 0)
                    .request();
                return Boolean(block?.encodedBlockConfirmation);
            }, h.event.protocolEventTimeoutMs());
            const firstBlock = await h
                .control(sourcePeer)
                .query.getBlockByHeight(newForkId, 0)
                .request();

            // With nothing reducible the block queues for sync instead.
            await h.transition.ingestBlockConfirmationWait({
                peerIndex: targetPeerIndex,
                blockConfirmation: Codec.decode(
                    firstBlock!.encodedBlockConfirmation,
                    Type.BlockConfirmation
                ),
                ingestOptions: { senderAddress: writerPeer!.address },
                keepConnection: true,
                waitForProcessed: false
            });

            await waitFor(
                async () =>
                    await h
                        .control(targetPeer)
                        .query.isBlockQueued(firstBlock!.hash)
                        .request(),
                h.event.protocolEventTimeoutMs()
            );
            expect(
                await h.control(targetPeer).query.getForkId().request()
            ).to.equal(
                originalForkId,
                "target peer must not transition while nothing is reducible"
            );
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(0);

            // The reduced-snapshot event must be held before releasing, so
            // the replay below is what drives the transition.
            await waitFor(
                async () => (await race.heldSnapshotEventCount()) > 0,
                h.event.protocolEventTimeoutMs(),
                50
            );

            // Release: real reduction back first, then the replayed snapshot
            // event reduces on the spot and the post-transition queue drain
            // executes the early block.
            await restoreReduce();
            await race.release();

            await waitFor(
                async () =>
                    (await h
                        .control(targetPeer)
                        .query.getForkId()
                        .request()) === newForkId,
                h.event.protocolEventTimeoutMs()
            );
            await waitFor(
                async () =>
                    (await h
                        .control(targetPeer)
                        .query.getBlockByHeight(newForkId, 0)
                        .request()) !== null,
                h.event.protocolEventTimeoutMs()
            );
            expect(
                h.event.getEventCallCount(targetPeerIndex, "onSetState")
            ).to.equal(1);
            // The queued block was drained by the transition BEFORE its timeout,
            // so it was never synced at all (arrival-time sync is gone; the
            // timeout is the sole sync probe and the transition beat it). The
            // honest supplier is never punished.
            expect(
                await h.rpcStub.spectateSyncCallCount(targetPeerIndex)
            ).to.equal(0);
            expect(
                await h
                    .control(targetPeer)
                    .query.isBlacklisted(writerPeer!.address)
                    .request()
            ).to.equal(false);

            await restoreSync();
        });

        // Unit scope for the strategy fallback: the queue gate keeps unknown
        // forks out of validation, so drive the real strategy directly on a
        // real queued entry (host-side, all collaborators live).
        describe("wrongGenesisDetected (host-side unit scope)", function () {
            it("missing genesis: no proof to build, sources blacklisted, no dispute", async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 0, {
                    timeConfig: {
                        p2pTime: 3,
                        agreementTime: 10,
                        chainFallbackTime: 30,
                        evidenceTime: 8
                    }
                });

                const observer = h.getPeer(0);
                const author = h.getPeer(1);
                const supplier = h.getPeer(2);

                // Hold the sync flow so the strategy call is the only thing
                // that can punish the supplier (the ingest quarantine would
                // otherwise blacklist them through the failed sync as well).
                const restoreSync = await h.rpcStub.recordSpectateSync(0, {
                    forward: false
                });

                const { bogusBlock, blockConfirmation } =
                    await h.byzantine.craftBogusForkBlockZero(author.index);
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observer.index,
                    blockConfirmation,
                    ingestOptions: { senderAddress: supplier.address },
                    keepConnection: true,
                    waitForProcessed: false
                });
                expect(
                    await h
                        .control(observer)
                        .query.isBlockQueued(bogusBlock.hash)
                        .request()
                ).to.equal(true);

                const r = await h.execOnHost(
                    observer,
                    async (sm, args) => {
                        const entry = sm.storage.queues.getQueuedEntry(
                            args.hash as any
                        );
                        if (!entry) return null;
                        const strategy =
                            sm.getActiveValidationStrategy() as any;
                        const fraudProofService =
                            strategy.fraudProofService as any;
                        const disputeManager = strategy.disputeManager as any;

                        // The proof builder itself must refuse a fork with no
                        // genesis snapshot - descriptively, not via a `!`.
                        let thrownMessage = "";
                        try {
                            fraudProofService.createWrongGenesisProof(
                                entry.block
                            );
                        } catch (e) {
                            thrownMessage =
                                e instanceof Error ? e.message : String(e);
                        }

                        let proofs = 0;
                        let disputes = 0;
                        const originalProof =
                            fraudProofService.createWrongGenesisProof.bind(
                                fraudProofService
                            );
                        const originalDispute =
                            disputeManager.dispute.bind(disputeManager);
                        fraudProofService.createWrongGenesisProof = (
                            ...a: unknown[]
                        ) => {
                            proofs += 1;
                            return originalProof(...a);
                        };
                        // Record-only: a real dispute would derail the session.
                        disputeManager.dispute = async () => {
                            disputes += 1;
                        };
                        try {
                            const result =
                                await strategy.wrongGenesisDetected(entry);
                            return { result, proofs, disputes, thrownMessage };
                        } finally {
                            fraudProofService.createWrongGenesisProof =
                                originalProof;
                            disputeManager.dispute = originalDispute;
                        }
                    },
                    { hash: bogusBlock.hash }
                );

                expect(r).to.not.equal(null);
                expect(r!.thrownMessage).to.match(
                    /Missing genesis snapshot for fork/
                );
                expect(r!.result).to.equal(BlockValidationResult.DISCONNECT);
                expect(r!.proofs).to.equal(0);
                expect(r!.disputes).to.equal(0);
                // The real p2pManager cut the entry's supplier AND its author.
                expect(
                    await h
                        .control(observer)
                        .query.isBlacklisted(supplier.address)
                        .request()
                ).to.equal(true);
                expect(
                    await h
                        .control(observer)
                        .query.isBlacklisted(author.address)
                        .request()
                ).to.equal(true);

                await restoreSync();
            });

            it("present genesis: builds the WrongGenesis proof and disputes the fork", async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 0, {
                    timeConfig: { agreementTime: 10 }
                });
                // Setup only needs block 0 present on the observer - don't
                // gate on suite-wide finalization (load-flake under parallel).
                await h.transition.advanceState({
                    waitForPeers: [0],
                    waitForFinalization: false
                });

                const observer = h.getPeer(0);
                const r = await h.execOnHost(observer, async (sm) => {
                    const strategy = sm.getActiveValidationStrategy() as any;
                    const disputeManager = strategy.disputeManager as any;
                    const fraudProofService = strategy.fraudProofService as any;
                    const block = sm.storage.blocks.getBlock(sm.forkId, 0)!;
                    const entry = sm.storage.queues.createEntry(block);

                    let proofHash: unknown;
                    const disputed: unknown[] = [];
                    const originalProof =
                        fraudProofService.createWrongGenesisProof.bind(
                            fraudProofService
                        );
                    const originalDispute =
                        disputeManager.dispute.bind(disputeManager);
                    fraudProofService.createWrongGenesisProof = (
                        ...a: unknown[]
                    ) => {
                        proofHash = originalProof(...a);
                        return proofHash;
                    };
                    // Record-only: an on-chain dispute against an honest
                    // block would derail the session; the proof stays real.
                    disputeManager.dispute = async (forkId: unknown) => {
                        disputed.push(String(forkId));
                    };
                    try {
                        const result =
                            await strategy.wrongGenesisDetected(entry);
                        return {
                            result,
                            disputed,
                            forkId: String(sm.forkId),
                            proofStored: proofHash
                                ? !!sm.storage.fraudProofs.getFraudProofByHash(
                                      proofHash as any
                                  )
                                : false
                        };
                    } finally {
                        fraudProofService.createWrongGenesisProof =
                            originalProof;
                        disputeManager.dispute = originalDispute;
                    }
                });

                expect(r.result).to.equal(BlockValidationResult.DISPUTE);
                expect(r.disputed).to.deep.equal([r.forkId]);
                expect(r.proofStored).to.equal(true);
            });
        });

        describe("stale-fork entry gates (host-side unit scope)", function () {
            it("never validates an entry whose fork is not current", async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 0, {
                    timeConfig: {
                        p2pTime: 3,
                        agreementTime: 10,
                        chainFallbackTime: 30,
                        evidenceTime: 8
                    }
                });

                const observer = h.getPeer(0);
                const author = h.getPeer(1);
                const supplier = h.getPeer(2);

                // Record-only sync from the start: the gate paths must only
                // *ask* for sync; the flow itself is covered above.
                const restoreSync = await h.rpcStub.recordSpectateSync(0, {
                    forward: false
                });

                // The real ingest quarantines the wrong-fork block - its
                // queued entry is the staging material for the gates.
                const { bogusBlock, blockConfirmation } =
                    await h.byzantine.craftBogusForkBlockZero(author.index);
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observer.index,
                    blockConfirmation,
                    ingestOptions: { senderAddress: supplier.address },
                    keepConnection: true,
                    waitForProcessed: false
                });
                expect(
                    await h
                        .control(observer)
                        .query.isBlockQueued(bogusBlock.hash)
                        .request()
                ).to.equal(true);

                const r = await h.execOnHost(
                    observer,
                    async (sm, args) => {
                        const manager = sm.blockQueueManager as any;
                        const timeoutManager = sm.timeoutManager as any;
                        const stub = sm.p2pManager.localRpc.stub;
                        const hash = args.hash as any;

                        let queueTimeoutsScheduled = 0;
                        const syncBase = stub.spectateSyncCallCount;
                        const originalSchedule =
                            timeoutManager.scheduleTask.bind(timeoutManager);
                        timeoutManager.scheduleTask = (
                            task: () => unknown,
                            delayMs: number,
                            taskName = "unnamed"
                        ) => {
                            if (
                                taskName.startsWith(
                                    "BlockQueueManager.queueTimeout"
                                )
                            ) {
                                queueTimeoutsScheduled += 1;
                                return { delayMs };
                            }
                            return originalSchedule(task, delayMs, taskName);
                        };
                        try {
                            // (a) a stale forkId argument is not authority
                            await manager.tryExecuteFromQueue(args.forkId);
                            const staleArgIgnored =
                                !!sm.storage.queues.getQueuedEntry(hash);

                            // (b) a dequeued entry whose fork is no longer
                            // current is NEVER validated: the real pipeline sees
                            // the fork mismatch and, since this bogus fork is
                            // unknown (not a fork we've moved past), restores it
                            // for its timeout to sync rather than validating,
                            // dropping, or syncing inline. "Not validated" is
                            // observed as the block never reaching storage.
                            const entry = sm.storage.queues.removeBlock(hash)!;
                            // The dequeue owns the entry - drop the real
                            // eviction timer the ingest scheduled.
                            manager.cancelQueueTimeout(hash);
                            await manager.executeQueuedEntry(entry);
                            const restored =
                                !!sm.storage.queues.getQueuedEntry(hash);
                            const stored =
                                sm.storage.blocks.getBlock(hash) !== undefined;
                            const syncDelta =
                                stub.spectateSyncCallCount - syncBase;

                            return {
                                staleArgIgnored,
                                restored,
                                stored,
                                queueTimeoutsScheduled,
                                syncDelta
                            };
                        } finally {
                            timeoutManager.scheduleTask = originalSchedule;
                        }
                    },
                    { hash: bogusBlock.hash, forkId: bogusBlock.forkId }
                );

                expect(r.staleArgIgnored).to.equal(true);
                // Unknown fork: restored for a timeout sync, re-arming exactly
                // one queue timeout; never validated (never stored), never
                // synced inline.
                expect(r.restored).to.equal(true);
                expect(r.stored).to.equal(false);
                expect(r.queueTimeoutsScheduled).to.equal(1);
                expect(r.syncDelta).to.equal(0);

                await restoreSync();
            });
        });
    });

    describe("queue timeout window (host-side unit scope)", function () {
        it("schedules the full window fresh, only the remainder after aging, and nothing at the deadline", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                timeConfig: {
                    p2pTime: 3,
                    agreementTime: 10,
                    chainFallbackTime: 30,
                    evidenceTime: 8
                }
            });
            // Setup only needs block 0 present on the observer - don't gate
            // on suite-wide finalization (load-flake under parallel).
            await h.transition.advanceState({
                waitForPeers: [0],
                waitForFinalization: false
            });

            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const manager = sm.blockQueueManager as any;
                    const timeoutManager = sm.timeoutManager as any;
                    const agreementTime = sm.timeConfig.agreementTime;
                    const block = sm.storage.blocks.getBlock(
                        args.forkId as any,
                        0
                    )!;

                    // Capture queue-timeout scheduling; forward the rest.
                    const scheduled: { delayMs: number }[] = [];
                    const cancelled: unknown[] = [];
                    const originalSchedule =
                        timeoutManager.scheduleTask.bind(timeoutManager);
                    const originalCancel =
                        timeoutManager.cancelTask.bind(timeoutManager);
                    timeoutManager.scheduleTask = (
                        task: () => unknown,
                        delayMs: number,
                        taskName = "unnamed"
                    ) => {
                        if (
                            taskName.startsWith(
                                "BlockQueueManager.queueTimeout"
                            )
                        ) {
                            const handle = { delayMs };
                            scheduled.push(handle);
                            return handle;
                        }
                        return originalSchedule(task, delayMs, taskName);
                    };
                    timeoutManager.cancelTask = (handle: unknown) => {
                        if (scheduled.includes(handle as never)) {
                            cancelled.push(handle);
                            return;
                        }
                        return originalCancel(handle);
                    };
                    // Storage is behind a deep-copy proxy: a fetched entry is
                    // a copy, so aging goes through remove -> mutate -> restore.
                    const ageEntryBy = (hash: unknown, seconds: number) => {
                        const entry = sm.storage.queues.removeBlock(
                            hash as any
                        )!;
                        entry.firstSeenAt -= seconds;
                        sm.storage.queues.restoreEntry(entry);
                    };
                    try {
                        const hash = sm.storage.queues.queueBlock(block);

                        const fresh = manager.scheduleQueueTimeout(hash);
                        const freshDelayMs =
                            scheduled[scheduled.length - 1]?.delayMs;

                        // Duplicate copies merge into the entry - age it
                        // precisely instead of sleeping.
                        ageEntryBy(hash, 4);
                        const aged = manager.scheduleQueueTimeout(hash);
                        const agedDelayMs =
                            scheduled[scheduled.length - 1]?.delayMs;
                        const cancelledAfterAging = cancelled.length;

                        ageEntryBy(hash, agreementTime); // past the deadline
                        const atDeadline = manager.scheduleQueueTimeout(hash);
                        const cancelledAfterDeadlineAttempt = cancelled.length;
                        const scheduledCount = scheduled.length;

                        manager.cancelQueueTimeout(hash);
                        sm.storage.queues.removeBlock(hash);
                        return {
                            agreementTime,
                            fresh,
                            freshDelayMs,
                            aged,
                            agedDelayMs,
                            cancelledAfterAging,
                            atDeadline,
                            cancelledAfterDeadlineAttempt,
                            scheduledCount
                        };
                    } finally {
                        timeoutManager.scheduleTask = originalSchedule;
                        timeoutManager.cancelTask = originalCancel;
                    }
                },
                { forkId }
            );

            const windowMs = r.agreementTime * 1000;
            expect(r.fresh).to.equal(true);
            // Full window, minus at most one whole-second clock tick.
            expect(r.freshDelayMs).to.be.within(windowMs - 1000, windowMs);
            expect(r.aged).to.equal(true);
            // Aging by 4s shrinks the delay by exactly 4s (same tick slack).
            expect(r.agedDelayMs).to.be.within(
                r.freshDelayMs! - 5000,
                r.freshDelayMs! - 4000
            );
            expect(r.cancelledAfterAging).to.equal(1); // fresh handle replaced
            expect(r.atDeadline).to.equal(false);
            expect(r.scheduledCount).to.equal(2); // nothing scheduled at the deadline
            // The deadline attempt must not cancel the live handle.
            expect(r.cancelledAfterDeadlineAttempt).to.equal(1);
        });
    });
});

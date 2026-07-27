import { expect } from "chai";
import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { Block } from "@/models";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import {
    MathTestSession as TestSession,
    MIN_TEST_TIME_CONFIG
} from "@test/harness";
import * as factory from "@test/factory";
import { waitFor } from "@test/utils/waitFor";
import type { Address } from "@/types/types";
import { Status } from "@/types";

// crafted confirmations run through validateBlockConfirmation host-side via
// stub.runBlockValidation (record-only side effects). asserts input -> result
// + which strategy hook fired. the queue layer is E2E-BlockQueueManager's.

const solProofType = (type: FraudProofType): string =>
    String(toSolidityFraudProofType(type));

// a wide evidence window keeps the height-0 participant timeout clear of the
// deliberate waits in the timestamp cases
const TIMESTAMP_TIME_CONFIG = { ...MIN_TEST_TIME_CONFIG, evidenceTime: 20 };

// wide enough that the deliberate waits in the parent-recovery cases stay
// clear of the participant timeout
const RECOVERY_TIME_CONFIG = {
    p2pTime: 2,
    agreementTime: 8,
    chainFallbackTime: 10,
    evidenceTime: 20
};
// height 0 gets the evidenceTime grace on top of the ordinary post window
const HEIGHT_ZERO_POST_WINDOW =
    TIMESTAMP_TIME_CONFIG.p2pTime +
    TIMESTAMP_TIME_CONFIG.agreementTime +
    TIMESTAMP_TIME_CONFIG.chainFallbackTime +
    TIMESTAMP_TIME_CONFIG.evidenceTime;

describe("Unit: ValidationService", function () {
    describe("isChannelOpen", function () {
        it("open fork (non-zero) → true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const open = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) =>
                    sm.validationService.isChannelOpen(args.forkId),
                { forkId: h.activeForkId! }
            );

            expect(open).to.equal(true);
        });
    });

    describe("validateBlockConfirmation → pre-transition guards", function () {
        it("connected to the channel but not yet synced → channelNotOpened → NOT_READY, requeued", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            // participants stop serving state, so a joining peer takes the
            // channelId but never learns a fork -> its forkId stays ZeroHash
            const restores = await Promise.all(
                h.peers.map((p) =>
                    h.rpcStub.recordSpectateSync(p.index, { forward: false })
                )
            );

            const { index: spectatorIndex } = await h.join.addSpectator();
            await h.event.waitUntilPeerStatus(spectatorIndex, Status.OPENED);
            const spectator = h.getPeer(spectatorIndex);

            const open = await h.execOnHost(spectator, async (sm) =>
                sm.validationService.isChannelOpen(sm.forkId)
            );
            expect(open, "a pre-sync peer holds no fork").to.equal(false);

            // a real block on the real channel - only the local fork is missing
            const encoded = await factory.buildAndEncodeBlock(
                h.getPeer(0).signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId: h.activeForkId!,
                        transactionCnt: 0
                    }
                }
            );

            const r = await h
                .control(spectator)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("NOT_READY");
            expect(r.firedHooks).to.include("channelNotOpened");
            expect(r.restoreQueuedEntryCalled).to.equal(true);
            expect(r.disputedForkIds).to.deep.equal([]);

            await Promise.all(restores.map((restore) => restore()));
        });

        it("block for a different channel → wrongChannel → DISCONNECT", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const observer = h.getPeer(0);

            // authentic block, but a channel this peer is not in
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: factory.hash(),
                    forkId: h.activeForkId!,
                    transactionCnt: 0,
                    participant: observer.address as Address
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISCONNECT");
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.firedHooks).to.include("wrongChannel");
        });

        it("author outside the participant set → blockAuthorIsNotParticipant → DISCONNECT", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const observer = h.getPeer(0);

            // right channel, but the author isn't in the participant set
            const outsider = factory.randomWallet();
            const encoded = await factory.buildAndEncodeBlock(outsider, {
                header: {
                    channelId: h.channelId,
                    forkId: h.activeForkId!,
                    transactionCnt: 0,
                    participant: outsider.address as Address
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISCONNECT");
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.firedHooks).to.include("blockAuthorIsNotParticipant");
        });

        it("height above nextHeight → blockIsNotNextAndIsInTheFuture → NOT_READY, requeued", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const nextHeight = 1;

            // participant author, at a height the peer can't execute yet
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight + 2,
                    participant: observer.address as Address
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            // not a peer fault -> restored for a timeout sync, no dispute
            expect(r.resultName).to.equal("NOT_READY");
            expect(r.restoreQueuedEntryCalled).to.equal(true);
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.firedHooks).to.include("blockIsNotNextAndIsInTheFuture");
        });

        it("next block, wrong previousBlockHash → blockIsNotLinkedAndIsNotFirstBlock → DISCONNECT", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const nextHeight = 2;

            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight,
                    participant: observer.address as Address
                },
                // not linked
                previousBlockHash: factory.hash()
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISCONNECT");
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.firedHooks).to.include(
                "blockIsNotLinkedAndIsNotFirstBlock"
            );
        });

        it("height-0 block not linked to genesis → wrongGenesisDetected → DISPUTE + WrongGenesis proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            // block 0 not linked to genesis
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: 0,
                    participant: observer.address as Address
                },
                previousBlockHash: factory.hash()
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            // genesis snapshot present -> real fraud proof + dispute on the fork
            expect(r.resultName).to.equal("DISPUTE");
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.WrongGenesis)
            );
        });

        it("linked next block by the wrong leader → invalidStateTransitionDetected → DISPUTE + InvalidStateTransition proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const nextHeight = 2;

            const [nextWriter, prevBlock] = await Promise.all([
                h.control(observer).query.getNextToWrite().request(),
                h.control(observer).query.getBlockByHeight(forkId, 1).request()
            ]);

            const nonLeader = h.peers.find(
                (p) => p.address.toLowerCase() !== nextWriter.toLowerCase()
            )!;
            const encoded = await factory.buildAndEncodeBlock(
                nonLeader.signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId,
                        transactionCnt: nextHeight,
                        // non-leader author
                        participant: nonLeader.address as Address
                    },
                    previousBlockHash: prevBlock!.hash
                }
            );

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.BlockInvalidStateTransition)
            );
        });
    });

    // the local union is read from the previous + resulting snapshots. a block
    // on a fork we hold no snapshots for leaves it empty -> the contract is the
    // only source of truth for who may author.
    describe("getParticipantsUnionOrOnChain → on-chain fallback", function () {
        it("empty local union, author in the on-chain active set → passes the author guard", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const author = h.getPeer(1);

            const onChainParticipants = await h.channelManager.getParticipants(
                h.channelId
            );
            expect(
                onChainParticipants.map((a: unknown) =>
                    String(a).toLowerCase()
                ),
                "author must be an on-chain active participant"
            ).to.include(author.address.toLowerCase());

            // unknown fork -> no previous snapshot, and the random resulting
            // stateSnapshotHash resolves to nothing -> empty local union
            const unknownForkId = factory.hash();
            const localUnion = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) =>
                    sm.storage.getParticipantsUnion({
                        forkId: args.forkId,
                        height: 1
                    }),
                { forkId: unknownForkId }
            );
            expect(
                localUnion,
                "local union must be empty so the contract is the only source"
            ).to.deep.equal([]);

            const encoded = await factory.buildAndEncodeBlock(author.signer, {
                header: {
                    channelId: h.channelId,
                    forkId: unknownForkId,
                    transactionCnt: 1
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            // the chain accepted the author -> a later guard is what stops it
            expect(r.firedHooks).to.not.include("blockAuthorIsNotParticipant");
            expect(r.firedHooks).to.include("blockIsNotNextAndIsInTheFuture");
            expect(r.resultName).to.equal("NOT_READY");
            expect(r.disputedForkIds).to.deep.equal([]);
        });

        it("empty local union, author only in the on-chain pending set → passes the author guard", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();

            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );

            const [pending, active] = await Promise.all([
                h.channelManager.getPendingParticipants(h.channelId),
                h.channelManager.getParticipants(h.channelId)
            ]);
            const joinerAddress = joiner.address.toLowerCase();
            expect(
                pending.map((a: unknown) => String(a).toLowerCase()),
                "joiner must be on-chain pending"
            ).to.include(joinerAddress);
            expect(
                active.map((a: unknown) => String(a).toLowerCase()),
                "joiner must not be an active participant yet"
            ).to.not.include(joinerAddress);

            const observer = h.getPeer(0);
            const unknownForkId = factory.hash();
            const encoded = await factory.buildAndEncodeBlock(joiner.signer, {
                header: {
                    channelId: h.channelId,
                    forkId: unknownForkId,
                    transactionCnt: 1
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            // pending participants are merged into the on-chain union
            expect(r.firedHooks).to.not.include("blockAuthorIsNotParticipant");
            expect(r.firedHooks).to.include("blockIsNotNextAndIsInTheFuture");
            expect(r.resultName).to.equal("NOT_READY");
            expect(r.disputedForkIds).to.deep.equal([]);
        });
    });

    describe("validateBlockConfirmation → checkConflictingBlock", function () {
        it("second block at a taken height by the same author → doubleSignDetected → DISPUTE + DoubleSign proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const [stored, prevBlock] = await Promise.all([
                h.control(observer).query.getBlockByHeight(forkId, 1).request(),
                h.control(observer).query.getBlockByHeight(forkId, 0).request()
            ]);
            const author = h.peers.find(
                (p) => p.address.toLowerCase() === stored!.author.toLowerCase()
            )!;

            // same author + height + link to the real prev, different content
            // (random stateSnapshotHash from the factory default) -> double sign
            const encoded = await factory.buildAndEncodeBlock(author.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: 1,
                    participant: author.address as Address
                },
                previousBlockHash: prevBlock!.hash
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.BlockDoubleSign)
            );
        });

        it("linked conflict at a taken height by a different author → invalidStateTransitionDetected → DISPUTE", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const [stored, prevBlock] = await Promise.all([
                h.control(observer).query.getBlockByHeight(forkId, 1).request(),
                h.control(observer).query.getBlockByHeight(forkId, 0).request()
            ]);
            // different author but linked to the real prev -> slashable divergence
            const other = h.peers.find(
                (p) => p.address.toLowerCase() !== stored!.author.toLowerCase()
            )!;
            const encoded = await factory.buildAndEncodeBlock(other.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: 1,
                    participant: other.address as Address
                },
                previousBlockHash: prevBlock!.hash
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.BlockInvalidStateTransition)
            );
        });

        it("conflict at height 0, not linked, different author → wrongGenesisDetected → DISPUTE + WrongGenesis proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1); // block 0 stored
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const stored = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 0)
                .request();
            // different author's block 0, unlinked. an unlinked conflict alone
            // DISCONNECTs, but at height 0 it's a wrong-genesis claim -> dispute.
            const other = h.peers.find(
                (p) => p.address.toLowerCase() !== stored!.author.toLowerCase()
            )!;
            const encoded = await factory.buildAndEncodeBlock(other.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: 0,
                    participant: other.address as Address
                },
                previousBlockHash: factory.hash()
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.WrongGenesis)
            );
        });

        it("the peer's own stored block replayed verbatim → doubleSignDetected → DISPUTE against the honest author", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            // feed block 1 back verbatim. checkConflictingBlock keys only on
            // (author,height), no content compare -> an identical replay is
            // flagged a double-sign of its own honest author. prod gates this
            // via BlockStorage equal-block dedup, so it's an in-isolation edge.
            const stored = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 1)
                .request();

            const r = await h
                .control(observer)
                .stub.runBlockValidation(stored!.encodedBlockConfirmation)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.BlockDoubleSign)
            );
        });

        it("conflict at a taken height, not linked, different author → conflictingButNotLinkedBlockDetected → DISCONNECT", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const stored = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 1)
                .request();
            const other = h.peers.find(
                (p) => p.address.toLowerCase() !== stored!.author.toLowerCase()
            )!;
            // unlinked conflict could sit on a double-signer's reality -> no slash
            const encoded = await factory.buildAndEncodeBlock(other.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: 1,
                    participant: other.address as Address
                },
                previousBlockHash: factory.hash()
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISCONNECT");
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.firedHooks).to.include(
                "conflictingButNotLinkedBlockDetected"
            );
        });
    });

    describe("validateBlockConfirmation → validateTimeLogic", function () {
        it("first block with a timestamp before genesis → objectiveInvalidTimestampDetected → DISPUTE + InvalidTimestamp proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // no blocks -> block 0 is next
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const [nextWriter, genesisHash] = await Promise.all([
                h.control(observer).query.getNextToWrite().request(),
                h
                    .control(observer)
                    .query.getGenesisSnapshotHash(forkId)
                    .request()
            ]);
            const leader = h.peers.find(
                (p) => p.address.toLowerCase() === nextWriter.toLowerCase()
            )!;

            // valid block 0 except a timestamp before genesis
            const encoded = await factory.buildAndEncodeBlock(leader.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: 0,
                    participant: leader.address as Address,
                    timestamp: 1
                },
                previousBlockHash: genesisHash!
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.InvalidTimestamp)
            );
        });

        it("non-first block, bad timestamp, previous block not on-chain → DISPUTE + InvalidTimestamp", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const nextHeight = 2;

            const [nextWriter, prevBlock] = await Promise.all([
                h.control(observer).query.getNextToWrite().request(),
                h.control(observer).query.getBlockByHeight(forkId, 1).request()
            ]);
            const leader = h.peers.find(
                (p) => p.address.toLowerCase() === nextWriter.toLowerCase()
            )!;

            // linked next block, timestamp before its parent's. NOT block 0, so
            // it tries an on-chain fetch for the parent; the parent isn't
            // on-chain -> nothing schedules -> fraud proof.
            const encoded = await factory.buildAndEncodeBlock(leader.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight,
                    participant: leader.address as Address,
                    timestamp: 1
                },
                previousBlockHash: prevBlock!.hash
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.InvalidTimestamp)
            );
        });

        it("previous-block calldata recovered, candidate now valid → recursive pass returns SUCCESS and caches the timestamp", async function () {
            const h = TestSession.getHarness();
            const staged = await h.scenario.previousBlockUnsignedByNextWriter({
                timeConfig: RECOVERY_TIME_CONFIG
            });
            const { observer, author, previous, forkId, parentPostTimestamp } =
                staged;

            // stamped at the parent's real post time: outside the parent's
            // own-timestamp window, inside the recovered one
            const candidateTimestamp = parentPostTimestamp;
            expect(candidateTimestamp).to.be.greaterThan(
                previous.timestamp + RECOVERY_TIME_CONFIG.p2pTime
            );

            const encoded = await factory.buildAndEncodeBlock(author.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: previous.height + 1,
                    timestamp: candidateTimestamp
                },
                previousBlockHash: previous.hash
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("SUCCESS");
            expect(r.disputedForkIds).to.deep.equal([]);
            // one recovery for the parent, then the recursive pass looks up the
            // candidate's own (unposted) calldata
            expect(r.calldataRecoveryQueries).to.equal(2);

            const cached = await h
                .control(observer)
                .query.getBlockByHeight(forkId, previous.height)
                .request();
            expect(cached!.onChainTimestamp).to.equal(parentPostTimestamp);
        });

        it("previous-block calldata recovered but the candidate is still invalid → objectiveInvalidTimestampDetected", async function () {
            const h = TestSession.getHarness();
            const staged = await h.scenario.previousBlockUnsignedByNextWriter({
                timeConfig: RECOVERY_TIME_CONFIG
            });
            const { observer, author, previous, forkId, parentPostTimestamp } =
                staged;

            // past the recovered post time's window too, so the better parent
            // data still can't legalise it
            const candidateTimestamp =
                parentPostTimestamp + RECOVERY_TIME_CONFIG.p2pTime + 2;
            expect(parentPostTimestamp).to.be.greaterThan(previous.timestamp);

            const encoded = await factory.buildAndEncodeBlock(author.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: previous.height + 1,
                    timestamp: candidateTimestamp
                },
                previousBlockHash: previous.hash
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.firedHooks).to.include(
                "objectiveInvalidTimestampDetected"
            );
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.InvalidTimestamp)
            );
            // exactly one recheck: the recursive pass sees the parent's cached
            // timestamp and proves the violation instead of re-querying
            expect(r.calldataRecoveryQueries).to.equal(1);
        });

        it("on-chain timestamp exactly at the post deadline → ON_TIME → SUCCESS even outside agreementTime", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                timeConfig: TIMESTAMP_TIME_CONFIG
            });
            const { observer, authored, forkId } =
                await h.transition.authorNextBlockOffWireWait();

            const genesisTimestamp = await h
                .control(observer)
                .query.getGenesisSnapshotTimestamp(forkId)
                .request();
            const deadline = genesisTimestamp! + HEIGHT_ZERO_POST_WINDOW;
            await h
                .control(observer)
                .stub.stageBlockCalldata(authored.encodedSignedBlock, deadline)
                .request();

            // leave the subjective window, so only the ON_TIME early return
            // can still yield SUCCESS
            const clockGap = await h.event.waitPastAgreementTime(
                observer.index,
                authored.timestamp
            );
            expect(clockGap).to.be.greaterThan(
                TIMESTAMP_TIME_CONFIG.agreementTime
            );

            const r = await h
                .control(observer)
                .stub.runBlockValidation(authored.encodedBlockConfirmation)
                .request();

            expect(r.resultName).to.equal("SUCCESS");
            expect(r.firedHooks).to.deep.equal([]);
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.fraudProofType).to.be.null;
        });

        it("on-chain timestamp one second past the deadline → objectiveInvalidTimestampDetected → DISPUTE + InvalidTimestamp", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                timeConfig: TIMESTAMP_TIME_CONFIG
            });
            const { observer, authored, forkId } =
                await h.transition.authorNextBlockOffWireWait();

            const genesisTimestamp = await h
                .control(observer)
                .query.getGenesisSnapshotTimestamp(forkId)
                .request();
            const deadline = genesisTimestamp! + HEIGHT_ZERO_POST_WINDOW;
            await h
                .control(observer)
                .stub.stageBlockCalldata(
                    authored.encodedSignedBlock,
                    deadline + 1
                )
                .request();

            const r = await h
                .control(observer)
                .stub.runBlockValidation(authored.encodedBlockConfirmation)
                .request();

            expect(r.resultName).to.equal("DISPUTE");
            expect(r.firedHooks).to.include(
                "objectiveInvalidTimestampDetected"
            );
            expect(r.disputedForkIds).to.deep.equal([forkId]);
            expect(r.fraudProofType).to.equal(
                solProofType(FraudProofType.InvalidTimestamp)
            );
        });

        it("no cached timestamp, calldata recoverable on-chain → recovered, persisted, ON_TIME → SUCCESS", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                timeConfig: TIMESTAMP_TIME_CONFIG
            });
            const { leader, observer, authored, forkId } =
                await h.transition.authorNextBlockOffWireWait();

            // the observer loses the subscribed posted-calldata delivery, so it
            // holds no timestamp until validation queries the chain itself
            await h
                .control(observer)
                .stub.stubDropSubscribedCalldataEvents()
                .request();

            await h
                .control(leader)
                .stub.postBlockCalldataOnChain(authored.encodedSignedBlock)
                .request();

            await waitFor(
                async () =>
                    (await h
                        .control(observer)
                        .stub.getDroppedCalldataPostedCount()
                        .request()) > 0,
                30000
            );

            const before = await h
                .control(observer)
                .query.getBlockByHeight(forkId, authored.height)
                .request();
            expect(before, "the observer must not hold the block yet").to.be
                .null;

            const r = await h
                .control(observer)
                .stub.runBlockValidation(authored.encodedBlockConfirmation)
                .request();

            // no cached timestamp -> validation asked EventSyncService, which
            // re-queried the log and stored the real on-chain timestamp
            expect(r.calldataRecoveryQueries).to.be.greaterThan(0);
            expect(r.resultName).to.equal("SUCCESS");
            expect(r.disputedForkIds).to.deep.equal([]);

            const recovered = await h
                .control(observer)
                .query.getBlockCalldataTimestamp(
                    forkId,
                    authored.height,
                    authored.author as Address
                )
                .request();
            expect(recovered, "recovered timestamp must be persisted").to.not.be
                .null;
        });

        it("objectively valid but never posted, received outside agreementTime → subjectiveInvalidTimestampDetected → NOT_ENOUGH_TIME", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                timeConfig: TIMESTAMP_TIME_CONFIG
            });
            const { observer, authored } =
                await h.transition.authorNextBlockOffWireWait();

            // no calldata staged -> NOT_POSTED, so the subjective clock decides
            const clockGap = await h.event.waitPastAgreementTime(
                observer.index,
                authored.timestamp
            );
            expect(clockGap).to.be.greaterThan(
                TIMESTAMP_TIME_CONFIG.agreementTime
            );

            const r = await h
                .control(observer)
                .stub.runBlockValidation(authored.encodedBlockConfirmation)
                .request();

            expect(r.resultName).to.equal("NOT_ENOUGH_TIME");
            expect(r.firedHooks).to.include(
                "subjectiveInvalidTimestampDetected"
            );
            expect(r.disputedForkIds).to.deep.equal([]);
        });

        it("the same stale unposted block under the dispute strategy → subjective check skipped → SUCCESS", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, {
                timeConfig: TIMESTAMP_TIME_CONFIG
            });
            const { observer, authored } =
                await h.transition.authorNextBlockOffWireWait();

            await h.event.waitPastAgreementTime(
                observer.index,
                authored.timestamp
            );

            // the subjective window is active-strategy only - dispute replay
            // audits old blocks long after they were produced
            const r = await h
                .control(observer)
                .stub.runBlockValidation(authored.encodedBlockConfirmation, {
                    strategy: "dispute"
                })
                .request();

            expect(r.resultName).to.equal("SUCCESS");
            expect(r.firedHooks).to.not.include(
                "subjectiveInvalidTimestampDetected"
            );
            expect(r.disputedForkIds).to.deep.equal([]);
        });
    });

    describe("validateBlockConfirmation → input envelope", function () {
        // no test: a forged author sig is rejected upstream (BlockQueueManager
        // isAuthentic), pinned by E2E-BlockQueueManager's forged-sig test.
        it.skip("forged author signature", function () {});

        it("stray confirmation signatures on an otherwise valid block → ignored, still SUCCESS", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            // real next block, authored off-wire
            const { leader, observer, authored } =
                await h.transition.authorNextBlockOffWireWait();

            // valid block re-wrapped with an outsider's stray confirmation sig -
            // confirmation sigs are the merge layer's concern, must not flip the verdict
            const block = Block.fromSignedBlock(
                Codec.decode(authored!.encodedSignedBlock, Type.SignedBlock)
            );
            const outsider = factory.randomWallet();
            const straySig = await outsider.signMessage(
                ethers.getBytes(block.hash)
            );
            const encoded = await factory.encodeAuthoredConfirmation(
                block,
                leader.signer,
                [straySig]
            );

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(r.resultName).to.equal("SUCCESS");
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.fraudProofType).to.be.null;
        });
    });

    describe("validateBlockConfirmation → happy path", function () {
        it("a valid next block from the expected leader → SUCCESS, no dispute", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            // real next block kept off-wire, so the observer hasn't stored it
            const { leader, observer, authored } =
                await h.transition.authorNextBlockOffWireWait();

            const r = await h
                .control(observer)
                .stub.runBlockValidation(authored!.encodedBlockConfirmation)
                .request();

            expect(r.resultName).to.equal("SUCCESS");
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.fraudProofType).to.be.null;
            expect(r.firedHooks).to.deep.equal([]);
            expect(r.signerAddress.toLowerCase()).to.equal(
                leader.address.toLowerCase()
            );
        });
    });

    describe("isDisputedFork", function () {
        it("an undisputed fork (and an unknown forkId) → false, no throw", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => ({
                    current: await sm.validationService.isDisputedFork(
                        args.forkId,
                        sm.channelId
                    ),
                    // a forkId a crafted block could carry - unknown to us,
                    // still false not a throw
                    bogus: await sm.validationService.isDisputedFork(
                        args.bogusForkId,
                        sm.channelId
                    )
                }),
                { forkId: h.activeForkId!, bogusForkId: factory.hash() }
            );

            expect(r.current).to.equal(false);
            expect(r.bogus).to.equal(false);
        });

        it("a block on the current fork while it is disputed → blockForkIsDisputed → NOT_READY, requeued", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const maliciousPeerIndex = 2;
            await h.lifecycle.start(4, 2, {
                timeConfig: {
                    p2pTime: 3,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                }
            });
            const forkId = h.activeForkId!;
            const observer = h.getPeer(observerIndex);

            // hold the observer's reduction so the disputed fork stays current
            const race = await h.rpcStub.holdReductionRace(observerIndex);

            // real invalid transition -> the fork is disputed on-chain
            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedAndCommitedWait();

            // the disputed-fork gate fires before future/linkage, so any
            // participant block on the fork reaches blockForkIsDisputed
            const nextHeight = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight,
                    participant: observer.address as Address
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            // sourceless entry -> requeue for the timeout sync, not a disconnect
            expect(r.resultName).to.equal("NOT_READY");
            expect(r.restoreQueuedEntryCalled).to.equal(true);
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.firedHooks).to.include("blockForkIsDisputed");

            await race.release({ replayEvents: false, runHeldTasks: false });
        });

        it("a disputed-fork block supplied by a peer that acknowledged the dispute → supplier disconnected, DISCONNECT", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const byzantineIndex = 1;
            const supplierIndex = 2;

            await h.scenario.activeChannelWithDispute({
                numPeers: 3,
                numBlocks: 2,
                byzantinePeer: byzantineIndex
            });
            const forkId = h.activeForkId!;
            const observer = h.getPeer(observerIndex);
            const supplier = h.getPeer(supplierIndex);

            // real acknowledgment exchange -> the observer records that the
            // supplier knows the fork is dead
            await h.rpc.requestDisputeAcknowledgment({
                peerIndex: observerIndex
            });
            await h.assert.rpc.allPeersAcknowledgedDispute({
                requestingPeer: observerIndex,
                excludePeers: [byzantineIndex]
            });

            const nextHeight = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded, {
                    senderAddress: supplier.address as Address
                })
                .request();

            expect(r.sourcePeers.map((a) => a.toLowerCase())).to.deep.equal([
                supplier.address.toLowerCase()
            ]);
            expect(r.firedHooks).to.include("blockForkIsDisputed");
            // every supplier knowingly built on the dead fork -> nothing honest
            // left to wait for
            expect(r.resultName).to.equal("DISCONNECT");
            expect(
                r.disconnectedAddresses.map((a) => a.toLowerCase())
            ).to.deep.equal([supplier.address.toLowerCase()]);
            expect(r.restoreQueuedEntryCalled).to.equal(false);
        });

        it("a disputed-fork block from a supplier with no acknowledgment on record → requeued, NOT_READY", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const byzantineIndex = 1;

            await h.scenario.activeChannelWithDispute({
                numPeers: 3,
                numBlocks: 2,
                byzantinePeer: byzantineIndex
            });
            const forkId = h.activeForkId!;
            const observer = h.getPeer(observerIndex);
            // a supplier the observer holds no acknowledgment for - an honest
            // peer that hasn't seen the dispute yet
            const unacknowledgedSupplier = factory.randomAddress();

            const nextHeight = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded, {
                    senderAddress: unacknowledgedSupplier
                })
                .request();

            expect(r.sourcePeers.map((a) => a.toLowerCase())).to.deep.equal([
                String(unacknowledgedSupplier).toLowerCase()
            ]);
            expect(r.firedHooks).to.include("blockForkIsDisputed");
            // not provably byzantine -> restored for the timeout sync
            expect(r.resultName).to.equal("NOT_READY");
            expect(r.restoreQueuedEntryCalled).to.equal(true);
            expect(r.disconnectedAddresses).to.deep.equal([]);
        });
    });

    // the dispute strategy runs during dispute auditing (replaying a dispute's
    // state-proof blocks). it skips the disputed-fork/future gates and setStates
    // before the leader check. deviation hooks -> disputeValidation/*.
    describe("DisputeValidationStrategy divergences", function () {
        // no test: the missing previous-snapshot/state THROWS are defensive -
        // the state proof is verified on-chain first, so the chain is complete.
        it.skip("missing previous snapshot / state → throws (defensive)", function () {});

        // no test: these hooks need a real committed dispute to build fraud-proof
        // evidence against - beyond unit scope, covered in disputeValidation/* e2e.
        it.skip("deviation hooks build dispute evidence (see disputeValidation/*)", function () {});

        it("a block on a disputed fork → blockForkIsDisputed is skipped, validation continues", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const maliciousPeerIndex = 2;
            await h.lifecycle.start(4, 2, {
                timeConfig: {
                    p2pTime: 3,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                }
            });
            const forkId = h.activeForkId!;
            const observer = h.getPeer(observerIndex);

            // hold the observer's reduction so the disputed fork stays current
            const race = await h.rpcStub.holdReductionRace(observerIndex);
            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedAndCommitedWait();

            const nextHeight = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight
                }
            });

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded, { strategy: "dispute" })
                .request();

            // the hook throws on this strategy, so reaching a later guard is
            // proof the gate was skipped rather than merely quiet
            expect(r.firedHooks).to.not.include("blockForkIsDisputed");
            expect(r.firedHooks).to.include(
                "blockIsNotLinkedAndIsNotFirstBlock"
            );

            await race.release({ replayEvents: false, runHeldTasks: false });
        });

        it("a block above the next height → blockIsNotNextAndIsInTheFuture is skipped, validation continues", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const nextHeight = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();
            // well beyond what active storage can execute
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight + 5
                }
            });

            const active = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();
            expect(active.firedHooks).to.include(
                "blockIsNotNextAndIsInTheFuture"
            );

            const r = await h
                .control(observer)
                .stub.runBlockValidation(encoded, { strategy: "dispute" })
                .request();

            // dispute replay walks a proof's blocks, so height ordering against
            // active storage is not its concern
            expect(r.firedHooks).to.not.include(
                "blockIsNotNextAndIsInTheFuture"
            );
            expect(r.firedHooks).to.include(
                "blockIsNotLinkedAndIsNotFirstBlock"
            );
        });

        it("a valid linked next block by the leader passes setState + leader check → SUCCESS", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            // real next block, off-wire. under the dispute strategy it flows
            // through the setState-then-leader branch the block strategy lacks.
            const { observer, authored } =
                await h.transition.authorNextBlockOffWireWait();

            const r = await h
                .control(observer)
                .stub.runBlockValidation(authored!.encodedBlockConfirmation, {
                    strategy: "dispute"
                })
                .request();

            expect(r.resultName).to.equal("SUCCESS");
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.firedHooks).to.deep.equal([]);
        });
    });

    // the probe replaces shared live methods (dispute/disconnect/restore) while
    // it runs, so probes never overlap live state advancement - storage is
    // advanced between probes, never underneath one.
    describe("validateBlockConfirmation → storage interleaving", function () {
        it("the same candidate crosses the future→next boundary as storage advances → NOT_READY then DISCONNECT", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 1);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const startHeight = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();

            const advanceCount = 2;
            const candidateHeight = startHeight + advanceCount;

            // participant author, unlinked, two heights ahead of storage
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: candidateHeight
                },
                previousBlockHash: factory.hash()
            });

            // before: the height is unreachable -> deferred, no punishment
            const beforeAdvance = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(beforeAdvance.resultName).to.equal("NOT_READY");
            expect(beforeAdvance.restoreQueuedEntryCalled).to.equal(true);
            expect(beforeAdvance.firedHooks).to.include(
                "blockIsNotNextAndIsInTheFuture"
            );
            expect(beforeAdvance.disputedForkIds).to.deep.equal([]);
            expect(beforeAdvance.disconnectedAddresses).to.deep.equal([]);

            // storage advances with no probe in flight
            await h.transition.advanceState({ count: advanceCount });

            const heightAfterAdvance = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();
            // the candidate is now exactly the next height, not the future
            expect(heightAfterAdvance).to.equal(candidateHeight);

            // after: the same bytes are now judged on linkage instead
            const afterAdvance = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();

            expect(afterAdvance.resultName).to.equal("DISCONNECT");
            expect(afterAdvance.firedHooks).to.include(
                "blockIsNotLinkedAndIsNotFirstBlock"
            );
            expect(afterAdvance.firedHooks).to.not.include(
                "blockIsNotNextAndIsInTheFuture"
            );
            // an unlinked block is not slashable - no fork dispute either way
            expect(afterAdvance.disputedForkIds).to.deep.equal([]);

            await h.assert.sync.peersInSyncWait();
        });

        it("concurrent probes are serialized → every one gets an uncorrupted patch/restore", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 1);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const startHeight = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();

            // far-future height -> NOT_READY is the only reachable verdict, so
            // any deviation is a probe clobbering another probe's replacements
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: startHeight + 100
                }
            });

            const probeCount = 5;
            const results = await Promise.all(
                Array.from({ length: probeCount }, () =>
                    h
                        .control(observer)
                        .stub.runBlockValidation(encoded)
                        .request()
                )
            );

            expect(results).to.have.lengthOf(probeCount);
            for (const r of results) {
                expect(r.resultName).to.equal("NOT_READY");
                // the restore replacement was still installed when the hook ran
                expect(r.restoreQueuedEntryCalled).to.equal(true);
                expect(r.firedHooks).to.deep.equal([
                    "blockIsNotNextAndIsInTheFuture"
                ]);
                expect(r.disputedForkIds).to.deep.equal([]);
                expect(r.disconnectedAddresses).to.deep.equal([]);
            }

            await h.assert.sync.peersInSyncWait();
        });
    });
});

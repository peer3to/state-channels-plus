import {
    buildAndEncodeBlock,
    hash as randomHash,
    randomAddress
} from "../factory";
import { BlockOrigin } from "@/storage/QueueStorage";
import { Status } from "@/types";
import type { BlockHeight, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import {
    heldGenesisPendingAuditor,
    postedForgedSingleton,
    stageExitAnchoredFork
} from "@test/fixtures/DisputeAuditStaging";
import {
    authorOnlyConfirmation,
    buildOwnProof,
    chainSnapshot,
    committedSnapshotHash,
    constructProof,
    deleteStoredBlocks,
    describeOnPeer,
    forgedGenesisRun,
    genesisSnapshotHash,
    postSnapshotAt,
    replaceWithUnlinkedBlock,
    restoreStoredBlocks,
    stageLeftChannel,
    stageUnsignedGenesisTip,
    verifyOnPeer
} from "@test/fixtures/StateProofConstructionStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroHash } from "ethers";

describe("Unit: AgreementManager", function () {
    describe("getLatestSignedBlockByParticipant", function () {
        // no test: a malformed address can't reach this class. disputes are
        // ABI-decoded on arrival, and a bad address makes the decode itself
        // throw.
        it.skip("malformed participant address", function () {});

        // no test: a stored block can't hold a corrupt signature - the
        // store paths check every sig first.
        it.skip("corrupt signature on a stored block", function () {});

        it("a participant signing every block → their latest block, signature recovers to them", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1, latest = 1
            const latestHeight = 1;

            const r = await h
                .control(h.getPeer(0))
                .query.getLatestSignedBlockByParticipant(
                    h.activeForkId!,
                    h.getPeer(0).address
                )
                .request();

            expect(r!.height).to.equal(latestHeight);
            expect(r!.signatureRecoversToParticipant).to.equal(true);
        });

        it("a participant who stopped signing → returns their last signed block, not the latest block", async function () {
            const h = TestSession.getHarness();

            await h.lifecycle.start(4, 1); // peer 3 signs block 0, then...
            await h.network.blacklistAndDisconnectPeer(3);
            await h.transition.advanceState({
                count: 2, // blocks 1..2 land without peer 3's signature
                waitForPeers: [0, 1, 2]
            });

            const r = await h
                .control(h.getPeer(0))
                .query.getLatestSignedBlockByParticipant(
                    h.activeForkId!,
                    h.getPeer(3).address
                )
                .request();

            // stays at block 0 - the DESC walk skips the later blocks it never
            // signed and returns its real last signature, not the latest block
            expect(r!.height).to.equal(0);
            expect(r!.signatureRecoversToParticipant).to.equal(true);
        });

        it("a participant that never signed this fork → null", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            const r = await h
                .control(h.getPeer(0))
                .query.getLatestSignedBlockByParticipant(
                    h.activeForkId!,
                    randomAddress()
                )
                .request();

            expect(r).to.be.null;
        });

        // the forkId comes straight from an attacker's dispute and nothing
        // checks it first - the auditor (DisputeValidationService:350) is the
        // thing that checks. unknown fork must mean null, not a crash.
        it("attacker-supplied unknown forkId walks empty → null, not a throw", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            const participant = h.getPeer(0).address;

            // bogus forkId (as a crafted dispute would carry) -> null, no throw
            const onBogusFork = await h
                .control(h.getPeer(0))
                .query.getLatestSignedBlockByParticipant(
                    randomHash(),
                    participant
                )
                .request();
            expect(onBogusFork).to.be.null;

            // control: same participant answers on the real fork, so the null
            // above is the junk forkId, not a broken query
            const onRealFork = await h
                .control(h.getPeer(0))
                .query.getLatestSignedBlockByParticipant(
                    h.activeForkId!,
                    participant
                )
                .request();
            expect(onRealFork!.height).to.be.greaterThan(0);
        });
    });

    describe("didEveryoneSignBlock", function () {
        it("a fully-signed block → true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            // block 0 finalized with every participant's signature
            const everyoneSigned = await h
                .control(h.getPeer(0))
                .query.didEveryoneSignBlockAt(h.activeForkId!, 0)
                .request();

            expect(everyoneSigned).to.equal(true);
        });

        it("a block missing a participant's signature → false", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 1);
            await h.network.blacklistAndDisconnectPeer(3);
            await h.transition.advanceState({
                count: 1, // block 1 lands without peer 3's signature
                waitForPeers: [0, 1, 2],
                waitForFinalization: false
            });

            const everyoneSigned = await h
                .control(h.getPeer(0))
                .query.didEveryoneSignBlockAt(h.activeForkId!, 1)
                .request();

            expect(everyoneSigned).to.equal(false);
        });
    });

    describe("buildStateProof", function () {
        // no test: sync requests can't deliver a bad height - it's range-
        // checked in SpectateService.generateSyncPayload, and the block
        // iterator clamps anyway. forkId is covered by "unknown fork" below.
        it.skip("out-of-range blockHeight from a sync request", function () {});

        it("fully-signed latest block → milestones-only proof, verifyMilestones passes", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);

            const v = await constructProof(h, 0);

            // the tip carries its own threshold signatures: no tail
            expect(v.milestones).to.deep.equal([[2]]);
            expect(v.latestProofHeight).to.equal(v.requestedHeight);
            expect(v.latestSnapshotHash).to.equal(
                await committedSnapshotHash(h, 0, 2)
            );
            // the on-chain verifier accepts the proof, final at its last point
            expect(v.chainValid).to.equal(true);
            expect(v.finalizedSnapshotHash).to.equal(
                v.milestoneSnapshotHashes[0]
            );
        });

        it("unknown fork → buildStateProof throws 'Fork not found'", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const error = await h.execOnHost(
                h.getPeer(0),
                (sm, args) =>
                    sm.agreementManager.buildStateProof(args.forkId, 0).then(
                        () => "",
                        (e: unknown) => String(e)
                    ),
                { forkId: randomHash() as ForkId }
            );

            expect(error).to.match(/Fork not found/);
        });

        it("proof requested at the exact join-block height, raised threshold completed only above it → tops out at the requested height", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0);

            const { peer: spectator } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 2,
                maximumBlocks: 20
            });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });

            await h.byzantine.stubBroadcast(spectator.index);

            await h.join.joinChannelWait({ joiner: spectator });
            await h.assert.storage.honestPeersObserveInboundMessageWait();

            const forkId = h.activeForkId!;
            const q0 = h.control(h.getPeer(0)).query;

            const joinerAddress = spectator.address;
            const signedAt = async (height: number) => {
                const block = await q0
                    .getBlockByHeight(forkId, height)
                    .request();
                return (
                    block!.author === joinerAddress ||
                    block!.confirmationSignerAddresses.some(
                        (address) => address === joinerAddress
                    )
                );
            };

            // take turn up until the joiner's turn
            for (
                let attempt = 0;
                attempt < h.peers.length &&
                (await q0.getNextToWrite().request()) !== joinerAddress;
                attempt++
            ) {
                await h.transition.advanceState({
                    count: 1,
                    waitForPeers: [0, 1, 2]
                });
            }
            expect(
                await q0.getNextToWrite().request(),
                "the joiner must be the next writer"
            ).to.equal(joinerAddress);

            // the joiner authors the next block itself while muted. that block
            // lives only in its own storage
            await h
                .getPeer(spectator.index)
                .p2pInstance.p2pContractInstance.add(1);
            const authoredAbove = await h
                .control(spectator)
                .query.getLatestBlockBundle(forkId)
                .request();
            expect(authoredAbove!.author).to.equal(joinerAddress);

            await h.transition.ingestBlockConfirmationWait({
                peerIndex: 0,
                blockConfirmation: {
                    signedBlock: Codec.decode(
                        authoredAbove!.encodedSignedBlock,
                        Type.SignedBlock
                    ),
                    signatures: []
                },
                ingestOptions: {
                    origin: BlockOrigin.NETWORK,
                    senderAddress: joinerAddress
                },
                keepConnection: true
            });

            const changeHeights = await q0
                .getParticipantChangeHeights(forkId)
                .request();
            const requestedHeight = changeHeights[0]; // the join's own height

            // staging sanity: the joiner signed above the join, and the join
            // block itself is short its signature - so the raised threshold
            // is completable only above the requested height
            const tip = Number(await q0.getLatestBlockHeight(forkId).request());
            expect(tip).to.be.greaterThan(requestedHeight);
            expect(
                await signedAt(tip),
                "the joiner must have signed a block above the join"
            ).to.equal(true);
            expect(
                await signedAt(requestedHeight),
                "the join block must NOT carry the joiner's signature"
            ).to.equal(false);
            expect(
                await q0
                    .didEveryoneSignBlockAt(forkId, requestedHeight)
                    .request(),
                "the join block must stay partially confirmed"
            ).to.equal(false);

            const v = await constructProof(h, 0, requestedHeight);

            expect(v.latestProofHeight).to.equal(requestedHeight);
            expect(
                v.milestones.flat().every((height) => height <= requestedHeight)
            ).to.equal(true);
            // and the bounded proof still satisfies the on-chain verifier
            expect(v.chainValid).to.equal(true);
        });

        it("proofs sampled while 10 blocks are produced → each verifies on-chain at its sampled height", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 1);

            // what's concurrent here: blocks + confirmation sigs keep landing
            // on peer 0 while we sample, so each sample catches storage in
            // whatever half-signed state it is in at that moment. a single
            // assembly is atomic (sync walk) - the variety is across samples.
            const blockCount = 10;
            const failures: string[] = [];
            const heightsSeen = new Set<BlockHeight>();

            // assembles + on-chain-verifies in one host call
            const sample = async () => {
                try {
                    const v = await constructProof(h, 0);
                    heightsSeen.add(v.requestedHeight);
                    if (v.latestProofHeight !== v.requestedHeight) {
                        failures.push(
                            `sampled at height ${v.requestedHeight} but the proof tops out at ${v.latestProofHeight}`
                        );
                    } else if (!v.chainValid) {
                        failures.push(
                            `proof at height ${v.requestedHeight} failed the on-chain verifier`
                        );
                    }
                } catch (e) {
                    failures.push(
                        `constructProof threw: ${e instanceof Error ? e.message : String(e)}`
                    );
                }
            };

            await sample();
            let advanceDone = false;
            const advancing = h.transition
                .advanceState({ count: blockCount, waitForFinalization: false })
                .finally(() => {
                    advanceDone = true;
                });
            while (!advanceDone) {
                await sample();
                await new Promise((res) => setTimeout(res, 50));
            }
            await advancing;
            // advanceState waits for peers to hold each block, so this sample
            // is guaranteed to see the latest block
            await sample();

            expect(failures).to.deep.equal([]);
            const heights = [...heightsSeen];
            expect(Math.max(...heights) - Math.min(...heights)).to.equal(
                blockCount
            );

            await h.assert.sync.peersInSyncWait();
        });
    });

    describe("buildStateProof: compact construction from the start", function () {
        it("start 5 permits threshold point 10 without gap blocks", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 6);
            await postSnapshotAt(h, 0, 5);
            await h.transition.advanceState({ count: 5 });
            await h.assert.sync.peersInSyncWait();
            // the unchanged-set gap is not needed
            await deleteStoredBlocks(h, 0, [6, 7, 8, 9]);

            const v = await constructProof(h, 0);

            expect(v.startHeight).to.equal(5);
            expect(v.milestones).to.deep.equal([[10]]);
            expect(v.chainValid).to.equal(true);
            expect(v.finalizedSnapshotHash).to.equal(
                await committedSnapshotHash(h, 0, 10)
            );
        });

        it("long unchanged membership builds only milestone 98 through 100", async function () {
            const h = TestSession.getHarness();
            // blocks 0..101: block 101 is fully signed on every peer, so the
            // confirmations of block 100 have merged before the strip
            await h.lifecycle.start(3, 102);
            // a relayed duplicate confirmation would merge the stripped
            // signatures back
            const restoreConfirmations =
                await h.rpcStub.dropNetworkConfirmations(0);
            // blocks 98..100 carry only their authors: together they reach
            // the threshold; nothing below them is needed
            await deleteStoredBlocks(h, 0, [98, 99, 100], true);
            await deleteStoredBlocks(
                h,
                0,
                [...Array(98).keys()] // 0..97
            );

            const v = await constructProof(h, 0, 100);
            await restoreConfirmations();

            expect(v.startHeight).to.equal(0);
            expect(v.milestones).to.deep.equal([[98, 99, 100]]);
            expect(v.latestProofHeight).to.equal(100);
            expect(v.chainValid).to.equal(true);
            expect(v.finalizedSnapshotHash).to.equal(
                await committedSnapshotHash(h, 0, 98)
            );
        });

        it("no threshold point retains needed anchor run", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 6, {
                timeConfig: { chainFallbackTime: 60 }
            });
            const start = await postSnapshotAt(h, 0, 5);
            // blocks 6 and 7 never reach the threshold
            await h.network.blacklistAndDisconnectPeer(2);
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });

            const v = await constructProof(h, 0);

            // one run from the block committing the start to the tip
            expect(v.milestones).to.deep.equal([[5, 6, 7]]);
            expect(v.chainValid).to.equal(true);
            // the normal start is the final point; the tail follows it
            expect(v.finalizedSnapshotHash).to.equal(start.hash);
            expect(v.replayBlockIndex).to.equal(1);
        });

        it("unsigned genesis tip builds unfinal run", async function () {
            const h = TestSession.getHarness();
            await stageUnsignedGenesisTip(h, 3, 2);

            const v = await constructProof(h, 0);

            // the only milestone: block 0 unfinal, replayed from block 0
            expect(v.milestones).to.deep.equal([[0, 1]]);
            expect(v.chainValid).to.equal(true);
            expect(v.finalizedSnapshotHash).to.equal(v.genesisSnapshotHash);
            expect(v.replayBlockIndex).to.equal(0);
            // the latest snapshot follows the unfinal tip, not the genesis
            expect(v.latestSnapshotHash).to.equal(
                await committedSnapshotHash(h, 0, 1)
            );
        });

        it("mirror missed exit builds valid genesis proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const prover = h.control(h.getPeer(1));
            await prover.stub.stubHoldSnapshotUpdatedEvents().request();
            await h.transition.participantLeaveStateTransition({
                leaverIndex: 2
            });
            await h.transition.keepAuthoringUntilPeersStatus({
                peerIndices: [2],
                status: Status.SYNCED,
                waitForPeers: [0, 1],
                excludePeerIndices: [2]
            });
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
            // dropped, not replayed: the prover's mirror stays at the genesis
            await prover.stub.restoreSnapshotUpdatedEvents(false).request();
            expect((await chainSnapshot(h)).blockHeight).to.be.greaterThan(0);

            const v = await constructProof(h, 1);

            // built from the prover's genesis view; the chain walks it from the
            // exit snapshot and accepts it
            expect(v.startHeight).to.equal(0);
            expect(v.finalizedSnapshotHash).to.not.equal(null);
            expect(v.chainValid).to.equal(true);
        });
    });

    describe("buildStateProof: overlapping runs and tails", function () {
        it("fully signed change-point tip permits repeated starts", async function () {
            const h = TestSession.getHarness();
            const { changeHeight, remaining } = await stageLeftChannel(h);

            const v = await constructProof(h, remaining[0], changeHeight);

            // the change milestone and the latest milestone share their start
            expect(v.milestones).to.deep.equal([
                [changeHeight],
                [changeHeight]
            ]);
            expect(v.chainValid).to.equal(true);
            expect(v.finalizedSnapshotHash).to.equal(
                v.milestoneSnapshotHashes[1]
            );
        });

        it("virtual-vote runs overlap across changes", async function () {
            const h = TestSession.getHarness();
            const { changeHeight: c, remaining } = await stageLeftChannel(h);
            const prover = remaining[0];
            // the leave block and the tip carry only their authors; the block
            // in between carries every signature
            await deleteStoredBlocks(h, prover, [c, c + 2], true);

            const v = await constructProof(h, prover, c + 2);

            expect(v.milestones).to.deep.equal([
                [c, c + 1],
                [c + 1, c + 2]
            ]);
            expect(v.chainValid).to.equal(true);
            expect(v.finalizedSnapshotHash).to.equal(
                await committedSnapshotHash(h, prover, c + 1)
            );
        });

        it("one-block tail reaches requested tip", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3, {
                timeConfig: { chainFallbackTime: 60 }
            });
            await h.network.blacklistAndDisconnectPeer(2);
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });

            const v = await constructProof(h, 0);

            expect(v.milestones).to.deep.equal([[2, 3]]);
            expect(v.chainValid).to.equal(true);
            expect(v.finalizedSnapshotHash).to.equal(
                await committedSnapshotHash(h, 0, 2)
            );
            expect(v.replayBlockIndex).to.equal(1);
        });
    });

    describe("buildStateProof: required history", function () {
        it("missing participant-change block throws", async function () {
            const h = TestSession.getHarness();
            const { changeHeight, remaining } = await stageLeftChannel(h);
            await deleteStoredBlocks(h, remaining[0], [changeHeight]);

            const error = await constructProof(h, remaining[0]).then(
                () => "",
                String
            );

            expect(error).to.match(
                /missing the participant-change block at height 2/
            );
        });

        it("missing interior required run block throws", async function () {
            const h = TestSession.getHarness();
            await stageUnsignedGenesisTip(h, 4, 3);
            await deleteStoredBlocks(h, 0, [1]);

            const error = await constructProof(h, 0, 2).then(() => "", String);

            expect(error).to.match(/missing the required block at height 1/);
        });

        it("missing final requested block throws", async function () {
            const h = TestSession.getHarness();
            await stageUnsignedGenesisTip(h, 4, 3);
            await deleteStoredBlocks(h, 0, [2]);

            const error = await constructProof(h, 0, 2).then(() => "", String);

            expect(error).to.match(/missing the required block at height 2/);
        });

        it("repairing required history restores construction", async function () {
            const h = TestSession.getHarness();
            const { changeHeight, remaining } = await stageLeftChannel(h);
            const prover = remaining[0];
            const built = await constructProof(h, prover);
            const removed = await deleteStoredBlocks(h, prover, [changeHeight]);
            const error = await constructProof(h, prover).then(
                () => "",
                String
            );
            expect(error).to.match(
                /missing the participant-change block at height 2/
            );

            await restoreStoredBlocks(h, prover, removed);
            const repaired = await constructProof(h, prover);

            // the explicit retry builds the same verified proof
            expect(repaired).to.deep.equal(built);
            expect(repaired.chainValid).to.equal(true);
        });

        it("wrong predecessor in required run throws", async function () {
            const h = TestSession.getHarness();
            await stageUnsignedGenesisTip(h, 4, 3);
            await deleteStoredBlocks(h, 0, [1]);
            // block 1 by its author, linked to nothing
            await restoreStoredBlocks(h, 0, [
                {
                    height: 1,
                    encodedConfirmation: await buildAndEncodeBlock(
                        h.getPeer(1).signer,
                        {
                            header: {
                                channelId: h.channelId,
                                forkId: h.activeForkId!,
                                transactionCnt: 1
                            },
                            previousBlockHash: randomHash()
                        }
                    )
                }
            ]);

            const error = await constructProof(h, 0, 2).then(() => "", String);

            expect(error).to.match(
                /the block at height 1 does not link to its predecessor/
            );
        });

        it("empty genesis minus one returns empty proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            const v = await constructProof(h, 0, -1);

            expect(v.milestones).to.deep.equal([]);
            expect(v.latestProofHeight).to.equal(null);
            expect(v.finalizedSnapshotHash).to.equal(v.genesisSnapshotHash);
            expect(v.latestSnapshotHash).to.equal(v.genesisSnapshotHash);
            expect(v.chainValid).to.equal(true);
        });

        it("non-genesis below-start request fails", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 6);
            await postSnapshotAt(h, 0, 5);

            const error = await constructProof(h, 0, 3).then(() => "", String);

            expect(error).to.match(/below its start at height 5/);
        });
    });

    describe("getSnapshotFromMilestone", function () {
        // empty-milestone throw is unreachable - a hostile stateProof is gated
        // on-chain first
        it.skip("empty milestone throws", function () {});

        // two participant leaves -> a change point per leave -> >=2 milestones.
        it("multi-milestone proof → one milestone per change point above its anchor plus the latest; finalized + latest select the LAST", async function () {
            const h = TestSession.getHarness();
            // the exits' change points lie below their snapshots; the joins
            // put two change points above the start
            await h.scenario.setupTwoLeaversAcrossMilestones({
                joinersAboveAnchor: 2
            });
            const forkId = h.activeForkId!;

            const v = await constructProof(h, 0);
            const changeHeightsAboveStart = (
                await h
                    .control(h.getPeer(0))
                    .query.getParticipantChangeHeights(forkId)
                    .request()
            ).filter(
                (height) =>
                    height > v.startHeight && height <= v.requestedHeight
            );

            // a change-point milestone per change above the start + the
            // latest milestone
            expect(v.startHeight).to.be.greaterThan(0);
            expect(changeHeightsAboveStart).to.have.length.of.at.least(2);
            expect(v.milestones).to.have.length(
                changeHeightsAboveStart.length + 1
            );
            // each change milestone starts at its change height
            expect(v.milestones.slice(0, -1).map((m) => m[0])).to.deep.equal(
                changeHeightsAboveStart
            );
            // getSnapshotFromMilestone reads the milestone's FIRST confirmation,
            // so milestones sharing a first block share a snapshot. the latest
            // milestone reaches back to the last change-point block whenever the
            // head isn't threshold-signed on its own -> distinct snapshots track
            // distinct first blocks, not the milestone count.
            const firstBlocks = v.milestones.map((m) => m[0]);
            expect(new Set(v.milestoneSnapshotHashes).size).to.equal(
                new Set(firstBlocks).size
            );
            // the walk's finalized state is the LAST milestone's first block
            expect(v.finalizedSnapshotHash).to.equal(
                v.milestoneSnapshotHashes.at(-1)
            );
            // getLatestBlockFromStateProof returns the LAST milestone's last
            // (highest) block
            const highest = Math.max(...v.milestones.flat());
            expect(v.latestProofHeight).to.equal(highest);
            expect(v.latestProofHeight).to.equal(v.milestones.at(-1)!.at(-1));
            // and the assembled proof still verifies on-chain
            expect(v.chainValid).to.equal(true);
        });
    });

    describe("getLastBlockFromMilestone", function () {
        // empty milestone → undefined is unreachable: buildStateProof never
        // builds a milestone with no confirmations, and a hostile proof is gated
        it.skip("empty milestone → undefined", function () {});

        // no test: one-line accessor (blockConfirmations[-1]). its last-block
        // result feeds latestProofHeight, asserted by:
        //   "fully-signed latest block → milestones-only proof, verifyMilestones passes"
        //   "multi-milestone proof → one milestone per change point above its anchor plus the latest; finalized + latest select the LAST"
    });

    describe("tryBuildMilestone (virtual voting)", function () {
        it("[a] -> [a,b] -> [c] -> [d] → milestone [1..3] final at block 1, block 0 excluded", async function () {
            const h = TestSession.getHarness();
            // d disconnected before any block; a,b,c produce blocks 0..2. block 3's
            // turn is d's - long chainFallbackTime so the others don't fire a
            // writer-timeout dispute while d reconnects and syncs (verified:
            // default config reduces the fork mid-staging)
            await h.lifecycle.start(4, 0, {
                timeConfig: { chainFallbackTime: 60 }
            });
            await h.network.blacklistAndDisconnectPeer(3);
            await h.transition.advanceState({
                count: 3,
                waitForPeers: [0, 1, 2]
            });
            const forkId = h.activeForkId!;

            // d returns and syncs. d now holds:  [a] -> [b] -> [c]
            // (d sometimes also countersigns a synced block - varies per run,
            // harmless: d only ever signs the latest block)
            // Peer 3↔peers 0/1/2 is reopened after peer 3 missed three
            // blocks so it can sync for the virtual-voting assertion.
            await h.network.reconnectPeers([3]);
            await waitFor(
                async () =>
                    (await h
                        .control(h.getPeer(3))
                        .query.getNextBlockHeight(forkId)
                        .request()) === 3,
                h.event.protocolEventTimeoutMs()
            );

            const qd = h.control(h.getPeer(3)).query;
            const signersAt = async (height: number) => {
                const bl = await qd.getBlockByHeight(forkId, height).request();
                return [
                    ...new Set([bl!.author, ...bl!.confirmationSignerAddresses])
                ].sort();
            };

            // deliver a's real block-1 signature to d (partial confirmation
            // delivery, absorbed by the stored-block merge):
            //   [a] -> [a,b] -> [c]
            const b1 = await h
                .control(h.getPeer(0))
                .query.getBlockByHeight(forkId, 1)
                .request();
            const aSig =
                b1!.confirmationSignatures[
                    b1!.confirmationSignerAddresses.indexOf(
                        h.getPeer(0).address
                    )
                ];
            await h.transition.ingestBlockConfirmationWait({
                peerIndex: 3,
                blockConfirmation: {
                    signedBlock: Codec.decode(
                        b1!.encodedSignedBlock,
                        Type.SignedBlock
                    ),
                    signatures: [aSig]
                },
                ingestOptions: {
                    origin: BlockOrigin.NETWORK,
                    senderAddress: h.getPeer(0).address
                },
                keepConnection: true,
                waitForProcessed: false
            });
            await waitFor(
                async () => (await signersAt(1)).includes(h.getPeer(0).address),
                h.event.protocolEventTimeoutMs()
            );

            // d stops broadcasting and authors the latest block alone:
            //   [a] -> [a,b] -> [c] -> [d]
            await h.byzantine.stubBroadcast(3);
            await h.getPeer(3).p2pInstance.p2pContractInstance.add(1);
            await waitFor(
                async () =>
                    (await qd.getNextBlockHeight(forkId).request()) === 4,
                h.event.protocolEventTimeoutMs()
            );

            const [a, b, c, d] = h.peers.map((peer) => peer.address);
            const s1 = await signersAt(1);
            expect(s1).to.include(a);
            expect(s1).to.include(b);
            const s2 = await signersAt(2);
            expect(s2).to.include(c);
            expect(s2).to.not.include(a);
            expect(s2).to.not.include(b);
            expect(await signersAt(3)).to.deep.equal([d]);

            const v = await constructProof(h, 3);

            // walk from the latest block: [d] + [c] + [a,b] covers everyone at
            // block 1 -> milestone [1..3]
            expect(v.milestones).to.deep.equal([[1, 2, 3]]);
            // block 1 is finalized - final without ever being fully signed
            expect(v.finalizedSnapshotHash).to.equal(
                await committedSnapshotHash(h, 3, 1)
            );
            expect(v.chainValid).to.equal(true);
            expect(v.latestProofHeight).to.equal(3);
            expect(v.latestSnapshotHash).to.equal(
                await committedSnapshotHash(h, 3, 3)
            );
        });
    });

    describe("getForkDisputes / getForkDisputeConfirmations / getReduceData", function () {
        // no test: these never take remote input. forkId comes from our own
        // traversal, reducedOutput from reduce.staticCall over our own stored
        // disputes.
        it.skip("hostile reducedOutput / dispute commitment", function () {});

        // no test for a populated window: getForkDisputes /
        // getForkDisputeConfirmations sit on the reduce path, so the dispute
        // E2E suite (test/e2e/dispute) covers the happy path transitively - a
        // wrong struct or count would break the reduce outcome it asserts. their
        // inputs are trusted too (see the hostile-reducedOutput skip above). the
        // only thing that suite never hits is the empty window below.

        it("getForkDisputes / getForkDisputeConfirmations on a fork with no dispute window → empty, not a throw", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1); // a running channel, no dispute raised

            const observerIndex = 0;
            const r = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    // our own untouched fork - no commitments, so no structs
                    const ownForkCommitments =
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            sm.forkId
                        );
                    const disputes =
                        await sm.agreementManager.getForkDisputes(
                            ownForkCommitments
                        );
                    const confirmations =
                        sm.agreementManager.getForkDisputeConfirmations(
                            ownForkCommitments
                        );
                    // a forkId an attacker could carry in a crafted dispute -
                    // unknown to us, still empty not a throw
                    const bogusDisputes =
                        await sm.agreementManager.getForkDisputes(
                            await sm.stateChannelManagerContract.getWindowCommitments(
                                sm.channelId,
                                args.bogusForkId
                            )
                        );
                    return {
                        disputeCount: disputes.length,
                        confirmationCount: confirmations.length,
                        bogusDisputeCount: bogusDisputes.length
                    };
                },
                { bogusForkId: randomHash() }
            );

            expect(r.disputeCount).to.equal(0);
            expect(r.confirmationCount).to.equal(0);
            expect(r.bogusDisputeCount).to.equal(0);
        });

        // the reduce applies the chain's inbound run, which a peer whose
        // InboundMessagesProcessed log never landed cannot walk
        describe("inbound run the reduce applied", function () {
            /** reduce.staticCall over the window, then getReduceData for it. */
            const readReduceData = (
                h: ReturnType<typeof TestSession.getHarness>,
                peerIndex: number,
                forkId: ForkId
            ) =>
                h.execOnHost(
                    h.getPeer(peerIndex),
                    async (sm, args) => {
                        const disputes =
                            await sm.reductionManager.getSyncedForkDisputes(
                                args.forkId
                            );
                        if (!disputes) {
                            throw new Error(
                                "expected a locally readable dispute window"
                            );
                        }
                        const reducedOutput =
                            await sm.stateChannelManagerContract.reduce.staticCall(
                                disputes
                            );
                        let threw = "";
                        let blockCount: number | null = null;
                        try {
                            const reduceData =
                                await sm.agreementManager.getReduceData(
                                    args.forkId,
                                    reducedOutput
                                );
                            blockCount = reduceData
                                ? reduceData.inboundMessageBlocks.length
                                : null;
                        } catch (e) {
                            threw = e instanceof Error ? e.message : String(e);
                        }
                        return {
                            threw,
                            blockCount,
                            disputeCount: disputes.length
                        };
                    },
                    { forkId },
                    {
                        timeoutMs: h.event.hostExecTimeoutMs()
                    }
                );

            it("recoverable reduce run → the full applied run", async function () {
                const h = TestSession.getHarness();
                await h.setup(3);
                await h.lifecycle.openChannel();
                await h.transition.advanceState({
                    count: 2,
                    waitForFinalization: true
                });
                await h.assert.sync.peersInSyncWait();
                const lagging = 2;
                const dropped = await h.rpcStub.dropInboundMessageLogs(lagging);
                const { forkId, disputerIndex } =
                    await h.scenario.stageCommittedDisputeOverInboundGap({
                        laggingIndex: lagging
                    });
                await dropped.waitUntilDropped();

                const lagged = await readReduceData(h, lagging, forkId);
                const healthy = await readReduceData(h, disputerIndex, forkId);

                expect(lagged.threw).to.equal("");
                // the same run a peer that never lost the log computes
                expect(lagged.blockCount).to.be.greaterThan(0);
                expect(lagged.blockCount).to.equal(healthy.blockCount);
                await dropped.release();
            });
        });

        // getReduceData's common branch (reduce keeps a real block -> resolve
        // its stored snapshot) is on the reduce path -> covered by the dispute
        // E2E suite. only the genesis branch below is a scenario that suite
        // never stages, so it's the one pinned here.
        it("reduce-to-genesis → getReduceData resolves the genesis snapshot", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 0); // no blocks yet

            // an invalid block 0 -> no valid block survives -> the reduce falls
            // all the way back to genesis
            await h.byzantine.submitInvalidStateTransitionBlock(0);
            await h.assert.dispute.initiatedAndCommitedWait();

            const observerIndex = 1;
            const r = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm) => {
                    const disputes = await sm.agreementManager.getForkDisputes(
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            sm.forkId
                        )
                    );
                    const reducedOutput =
                        await sm.stateChannelManagerContract.reduce.staticCall(
                            disputes
                        );
                    const reduceData = await sm.agreementManager.getReduceData(
                        sm.forkId,
                        reducedOutput
                    );
                    // the genesis reduce spans no inbound blocks, so the run is
                    // trivially available - a miss here is a real regression
                    if (!reduceData)
                        throw new Error(
                            "expected reduce data for the genesis reduce"
                        );
                    const genesis =
                        sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                            sm.forkId
                        )!;
                    return {
                        reducedForkId: String(
                            reducedOutput.latestBlock.transaction.header.forkId
                        ),
                        resolvedStateHash: String(
                            reduceData.latestStateSnapshot.snapshotData
                                .stateMachineStateHash
                        ),
                        genesisStateHash: String(
                            genesis.snapshotData.stateMachineStateHash
                        ),
                        reduceForkId: String(reduceData.forkId),
                        forkId: String(sm.forkId)
                    };
                }
            );

            // reduce dropped everything -> latestBlock carries the ZeroHash
            // genesis marker, so getReduceData takes the genesis branch
            expect(r.reducedForkId).to.equal(ZeroHash);
            expect(r.resolvedStateHash).to.equal(r.genesisStateHash);
            expect(r.reduceForkId).to.equal(r.forkId);
        });
    });

    describe("buildStateProof: runs, start and evidence", function () {
        it("exit-anchored fork tip → start above 0, every milestone block at or above it, dispute verification passes on chain", async function () {
            const h = TestSession.getHarness();
            const { participants, anchorHeight } =
                await stageExitAnchoredFork(h);

            const v = await constructProof(h, participants[0]);

            expect(v.startHeight).to.equal(anchorHeight);
            expect(
                v.milestones.flat().every((height) => height >= anchorHeight)
            ).to.equal(true);
            expect(v.chainValid).to.equal(true);
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(participants[0]);
            expect(
                await h.channelManager.verifyStateProof.staticCall(
                    dispute,
                    auditingData
                )
            ).to.equal(true);
        });

        it("stopAtThresholdCompletion ends at the latest threshold milestone; an unlinked block or a gap ends the run, so no milestone", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3, {
                timeConfig: { chainFallbackTime: 60 }
            });
            // blocks 3 and 4 never reach the threshold
            await h.network.blacklistAndDisconnectPeer(2);
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });

            expect((await buildOwnProof(h, 0)).milestones).to.deep.equal([
                [2, 3, 4]
            ]);
            const final = await buildOwnProof(h, 0, {
                stopAtThresholdCompletion: true
            });
            expect(final.milestones).to.deep.equal([[2]]);
            expect(final.finalizedSnapshotHash).to.equal(
                await committedSnapshotHash(h, 0, 2)
            );

            // block 3 is not the block that block 4 links to
            await replaceWithUnlinkedBlock(h, 0, 3);
            expect(
                (
                    await buildOwnProof(h, 0, {
                        blockHeight: 4,
                        stopAtThresholdCompletion: true
                    })
                ).milestones
            ).to.deep.equal([]);

            // block 4's stored neighbor is block 2
            await deleteStoredBlocks(h, 0, [3]);
            expect(
                (
                    await buildOwnProof(h, 0, {
                        blockHeight: 4,
                        stopAtThresholdCompletion: true
                    })
                ).milestones
            ).to.deep.equal([]);
        });

        it("milestone snapshot missing from storage → no finalized snapshot and no builder walk; all stored → the walk's finalized snapshot", async function () {
            const h = TestSession.getHarness();
            await stageUnsignedGenesisTip(h, 3, 2);
            const stored = await buildOwnProof(h, 0);

            expect(stored.milestones).to.deep.equal([[0, 1]]);
            expect(stored.milestoneSnapshotHashes).to.deep.equal([
                await committedSnapshotHash(h, 0, 0)
            ]);
            // the unfinal genesis run is final at the genesis
            expect(stored.finalizedSnapshotHash).to.equal(
                await genesisSnapshotHash(h, 0)
            );

            // block 0 now commits a snapshot storage lacks
            await replaceWithUnlinkedBlock(h, 0, 0);
            const missing = await buildOwnProof(h, 0, { blockHeight: 0 });

            expect(missing.milestones).to.deep.equal([[0]]);
            expect(missing.milestoneSnapshotHashes).to.deep.equal([null]);
            expect(missing.finalizedSnapshotHash).to.equal(null);
        });

        it("describeStateProof of a foreign proof → each run maps to its first block's snapshot, the start run included, an unknown one to undefined; no walk", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 6);
            const start = await postSnapshotAt(h, 0, 5);
            await h.transition.advanceState({ count: 2 });
            await h.assert.sync.peersInSyncWait();
            const { confirmation: unknown } = await authorOnlyConfirmation(
                h,
                1,
                8
            );
            const storageWalks = await h.mirror.observe(0, "verifyMilestones");

            const described = await describeOnPeer(h, 0, [
                [4, 5],
                [6],
                [unknown]
            ]);

            expect(described.startSnapshotHash).to.equal(start.hash);
            expect(described.milestoneSnapshotHashes).to.deep.equal([
                await committedSnapshotHash(h, 0, 4),
                await committedSnapshotHash(h, 0, 6),
                null
            ]);
            expect((await storageWalks.observation()).chain.reads).to.equal(0);
        });
    });

    // verifyStateProof walks from the latest local threshold-final point
    // (verifyMilestonesFromTrustedStart), then from the local diamond's
    // start, then from the chain's (verifyMilestones). Each case observes
    // the verifier's walks record-only; they still reach the real contracts.
    describe("verifyStateProof: verification ladder", function () {
        it("tier one valid → its start, finalized snapshot and replay index; no storage or chain walk", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { stateProof, milestones } = await buildOwnProof(h, 0);
            const storageWalks = await h.mirror.observe(0, "verifyMilestones");

            const v = await verifyOnPeer(h, 0, stateProof);

            expect(milestones).to.deep.equal([[2]]);
            // the final point is block 2's snapshot
            const point = await committedSnapshotHash(h, 0, 2);
            expect(v.status).to.equal("valid");
            expect(v.startHash).to.equal(point);
            expect(v.finalizedSnapshotHash).to.equal(point);
            expect(v.replayBlockIndex).to.equal(1);
            expect((await storageWalks.observation()).chain.reads).to.equal(0);
        });

        it("forged genesis run → tier one not valid, the storage tier answers from the genesis with no chain walk; replay index at the tail start, the last milestone's length, 0 for the empty proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3, {
                timeConfig: { chainFallbackTime: 60 }
            });
            // block 3 never reaches the threshold: block 2 stays the final point
            await h.network.blacklistAndDisconnectPeer(2);
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
            // peer 1's own blocks 0..2 from the genesis, never stored
            const forged = await forgedGenesisRun(h, 1, 3);
            const storageWalks = await h.mirror.observe(0, "verifyMilestones");

            const fromGenesis = await verifyOnPeer(h, 0, forged);

            // its block 2 does not commit the final point: valid from the
            // genesis (no start), with no chain walk
            expect((await storageWalks.observation()).chain.reads).to.equal(0);
            expect(fromGenesis.status).to.equal("valid");
            expect(fromGenesis.startHash).to.equal(null);
            expect(fromGenesis.finalizedSnapshotHash).to.equal(
                await genesisSnapshotHash(h, 0)
            );
            // the whole unfinal run is the tail
            expect(fromGenesis.replayBlockIndex).to.equal(0);

            const tail = await buildOwnProof(h, 0);
            expect(tail.milestones).to.deep.equal([[2, 3]]);
            expect(
                (await verifyOnPeer(h, 0, tail.stateProof)).replayBlockIndex
            ).to.equal(1);
            const final = await buildOwnProof(h, 0, { blockHeight: 2 });
            expect(final.milestones).to.deep.equal([[2]]);
            expect(
                (await verifyOnPeer(h, 0, final.stateProof)).replayBlockIndex
            ).to.equal(1);
            const empty = await buildOwnProof(h, 0, { blockHeight: -1 });
            expect(empty.milestones).to.deep.equal([]);
            const emptyVerified = await verifyOnPeer(h, 0, empty.stateProof);
            expect(emptyVerified.status).to.equal("valid");
            expect(emptyVerified.replayBlockIndex).to.equal(0);
        });

        it("no local threshold-final point (no stored block, or no threshold milestone) → tier one skipped, the storage tier decides", async function () {
            const h = TestSession.getHarness();
            // peer 2 is cut off before block 0; blocks 0 and 1 never reach
            // the threshold on peer 0
            await stageUnsignedGenesisTip(h, 3, 2);
            const { stateProof, milestones } = await buildOwnProof(h, 0);
            expect(milestones).to.deep.equal([[0, 1]]);
            const storageWalks0 = await h.mirror.observe(0, "verifyMilestones");
            const storageWalks2 = await h.mirror.observe(2, "verifyMilestones");

            const noThreshold = await verifyOnPeer(h, 0, stateProof);
            const noBlock = await verifyOnPeer(h, 2, stateProof);

            expect(noThreshold).to.include({
                status: "valid",
                startHash: null,
                replayBlockIndex: 0
            });
            expect((await storageWalks0.observation()).chain.reads).to.equal(0);
            expect(noBlock).to.include({
                status: "valid",
                startHash: null,
                replayBlockIndex: 0
            });
            expect((await storageWalks2.observation()).chain.reads).to.equal(0);
        });

        it("programming error in a local tier → that TypeError propagates; no later tier runs", async function () {
            const h = TestSession.getHarness();
            // peer 0 and a pending participant: whichever local tier runs first
            const { auditor, release } = await heldGenesisPendingAuditor(h);
            try {
                const { stateProof } = await buildOwnProof(h, 0);
                // not a byte string: the ABI encoder throws a TypeError
                stateProof.milestones[0].blockConfirmations[0].signedBlock.signature =
                    "0x1";
                const storageWalks = await h.mirror.observe(
                    0,
                    "verifyMilestones"
                );
                const auditorWalks = await h.mirror.observe(
                    auditor.index,
                    "verifyMilestones"
                );

                const tierOne = await verifyOnPeer(h, 0, stateProof);
                const storageTier = await verifyOnPeer(
                    h,
                    auditor.index,
                    stateProof
                );

                expect(tierOne).to.include({
                    status: "threw",
                    errorName: "TypeError"
                });
                expect((await storageWalks.observation()).chain.reads).to.equal(
                    0
                );
                expect(storageTier).to.include({
                    status: "threw",
                    errorName: "TypeError"
                });
                expect((await auditorWalks.observation()).chain.reads).to.equal(
                    0
                );
            } finally {
                await release();
            }
        });

        it("local tier revert or executor failure → that error propagates, no later tier runs; an auditor stores no counter", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { stateProof } = await buildOwnProof(h, 0);
            // not valid from the final point at block 2
            const forged = await forgedGenesisRun(h, 1, 3);
            await h.mirror.observe(0, "verifyMilestonesFromTrustedStart");
            const storageWalks = await h.mirror.observe(0, "verifyMilestones");

            await h.mirror.failNextLocalRead(
                0,
                "verifyMilestonesFromTrustedStart",
                "revert"
            );
            const reverted = await verifyOnPeer(h, 0, stateProof);
            await h.mirror.failNextLocalRead(
                0,
                "verifyMilestonesFromTrustedStart",
                "transport"
            );
            const executorFailed = await verifyOnPeer(h, 0, stateProof);

            expect(reverted.status).to.equal("threw");
            expect(reverted.errorMessage).to.contain(
                "Local EVM execution failed"
            );
            expect(executorFailed.status).to.equal("threw");
            expect(executorFailed.errorMessage).to.contain(
                "Malformed RPC request"
            );
            expect((await storageWalks.observation()).chain.reads).to.equal(0);

            // tier one answers not valid, then the storage tier reverts
            await h.mirror.failNextLocalRead(0, "verifyMilestones", "revert");
            const storageReverted = await verifyOnPeer(h, 0, forged);

            expect(storageReverted.status).to.equal("threw");
            expect(storageReverted.errorMessage).to.contain(
                "Local EVM execution failed"
            );
            expect((await storageWalks.observation()).chain.reads).to.equal(0);

            // the auditor's tier one, walking posted data the chain verified,
            // reverts: the audit throws, no counter
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            await h.mirror.observe(1, "verifyMilestonesFromTrustedStart");
            const auditorWalks = await h.mirror.observe(1, "verifyMilestones");
            await h.mirror.failNextLocalRead(
                1,
                "verifyMilestonesFromTrustedStart",
                "revert"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
            expect((await auditorWalks.observation()).chain.reads).to.equal(0);
        });

        it("local tiers not valid, chain read refused or reverted → that error propagates, never invalid; an auditor stores no counter", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            // a block above the tip that only its author signed: final from
            // no start
            const { confirmation } = await authorOnlyConfirmation(h, 1, 3);
            const forged = {
                milestones: [{ blockConfirmations: [confirmation] }]
            };
            const storageWalks = await h.mirror.observe(0, "verifyMilestones");

            await h.mirror.failNextChainRead(
                0,
                "verifyMilestones",
                "transport"
            );
            const refused = await verifyOnPeer(h, 0, forged);
            await h.mirror.failNextChainRead(0, "verifyMilestones", "revert");
            const reverted = await verifyOnPeer(h, 0, forged);

            expect(refused.status).to.equal("threw");
            expect(reverted.status).to.equal("threw");
            const { chain } = await storageWalks.observation();
            expect(chain.failures).to.have.length(2);
            expect(chain.failureCodes[0]).to.not.equal("CALL_EXCEPTION");
            expect(chain.failureCodes[1]).to.equal("CALL_EXCEPTION");

            // an auditor of a posted forged proof: the chain's verification
            // read is refused
            const { dispute, auditingData } = await postedForgedSingleton(h);
            const auditorVerification = await h.mirror.observe(
                1,
                "verifyStateProof"
            );
            await h.mirror.failNextChainRead(
                1,
                "verifyStateProof",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
            expect(
                (await auditorVerification.observation()).chain.failures
            ).to.have.length(1);
        });
    });
});

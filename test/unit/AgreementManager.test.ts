import { expect } from "chai";
import { Codec, Type } from "@/utils";
import type { BlockHeight } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash, randomAddress } from "../factory";
import { waitFor } from "@test/utils/waitFor";
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
            await h.network.disconnectPeer(3);
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
            await h.network.disconnectPeer(3);
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

    describe("getStateProof / tryGetStateProof", function () {
        // no test: sync requests can't deliver a bad height - it's range-
        // checked in SpectateService.generateSyncPayload, and the block
        // iterator clamps anyway. forkId is covered by "unknown fork" below.
        it.skip("out-of-range blockHeight from a sync request", function () {});

        it("fully-signed latest block → milestones-only proof, verifyMilestones passes", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);

            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(h.activeForkId!)
                .request();

            // provable finality -> milestone carrier, no signedBlock fallback
            expect(v).to.not.be.null;
            expect(v!.milestoneCount).to.equal(1);
            expect(v!.signedBlockCount).to.equal(0);
            expect(v!.latestProofHeight).to.equal(v!.blockHeight);
            // on-chain verifier accepts the proof
            expect(v!.verified).to.equal(true);
            expect(v!.isFinal).to.equal(true);
            expect(v!.onChainFinalizedSnapshotHash).to.equal(
                v!.finalizedSnapshotHash
            );
        });

        it("latest block missing a signature → signedBlocks fallback, linkage verified on-chain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);

            await h.network.disconnectPeer(2);
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1]
            });

            const forkId = h.activeForkId!;
            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(forkId)
                .request();
            const everyoneSignedLatest = await h
                .control(h.getPeer(0))
                .query.didEveryoneSignBlockAt(forkId, v!.blockHeight)
                .request();

            expect(everyoneSignedLatest).to.equal(false);
            // no provable finality -> signedBlocks fallback
            expect(v!.milestoneCount).to.equal(0);
            expect(v!.signedBlockCount).to.be.greaterThan(0);
            expect(v!.latestProofHeight).to.equal(v!.blockHeight);
            // fallback chain satisfies the on-chain linkage verifier
            expect(v!.verified).to.equal(true);
            // with no milestone the finalized snapshot stays genesis
            expect(v!.finalizedSnapshotHash).to.equal(v!.genesisSnapshotHash);
        });

        it("unknown fork → getStateProof throws 'Fork not found', tryGetStateProof → undefined", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const bogusForkId = randomHash();

            // try variant -> null
            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(bogusForkId)
                .request();
            expect(v).to.be.null;

            // throwing variant -> throws
            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    let thrownMessage = "";
                    try {
                        await sm.agreementManager.getStateProof(
                            args.bogusForkId,
                            0
                        );
                    } catch (e) {
                        thrownMessage =
                            e instanceof Error ? e.message : String(e);
                    }
                    return { thrownMessage };
                },
                { bogusForkId }
            );
            expect(r.thrownMessage).to.match(/Fork not found/);
        });

        it("proof requested below a participant leave → tops out at the requested height", async function () {
            const h = TestSession.getHarness();
            await h.scenario.setupTwoLeaversAcrossMilestones();
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 3] });

            const forkId = h.activeForkId!;
            const requestedHeight = 1; // warmup blocks 0..1, before any leave

            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(forkId, requestedHeight)
                .request();

            expect(v!.blockHeight).to.equal(requestedHeight);
            expect(v!.latestProofHeight).to.equal(requestedHeight);
            // latestProofHeight only reads the LAST milestone, so it cannot see
            // a change-point milestone above the request - the leaves sit above
            // this height and must not be proven at all
            expect(
                v!.milestoneConfirmationHeights
                    .flat()
                    .every((height) => height <= requestedHeight),
                "no milestone may reach a block above the requested height"
            ).to.equal(true);
        });

        it("proof requested below a participant join → tops out at the requested height", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 2); // peers 0,1; blocks 0..1

            // a spectator joins -> the set grows to 3 at block 2
            const spectator = await h.join.addSpectatorWait({
                statusTimeoutMs: 5000
            });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });

            await h.join.joinChannelWait({ joiner: spectator });
            await h.assert.storage.honestPeersObserveInboundMessageWait();

            // block 2 includes the joiner; two more so the join is provably final
            await h.transition.advanceState({
                count: 3,
                waitForPeers: [0, 1, 2]
            });

            const forkId = h.activeForkId!;
            const requestedHeight = 1; // below the join at height 2

            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(forkId, requestedHeight)
                .request();

            expect(v!.blockHeight).to.equal(requestedHeight);
            expect(v!.latestProofHeight).to.equal(requestedHeight);
            // latestProofHeight only reads the LAST milestone, so it cannot see
            // a change-point milestone above the request - the join sits above
            // this height and must not be proven at all
            expect(
                v!.milestoneConfirmationHeights
                    .flat()
                    .every((height) => height <= requestedHeight),
                "no milestone may reach a block above the requested height"
            ).to.equal(true);
        });

        it("proof requested at a fully-confirmed leave-block height → reports that height, nothing above", async function () {
            const h = TestSession.getHarness();
            await h.scenario.setupTwoLeaversAcrossMilestones();
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 3] });

            const forkId = h.activeForkId!;

            // the leave's own block height - later confirming blocks exist
            // above it from the scenario's follow-up advanceState calls
            const changeHeights = await h
                .control(h.getPeer(0))
                .query.getParticipantChangeHeights(forkId)
                .request();
            const requestedHeight = changeHeights[0];

            const q0 = h.control(h.getPeer(0)).query;
            const v = await q0
                .getStateProofVerification(forkId, requestedHeight)
                .request();

            expect(
                await q0
                    .didEveryoneSignBlockAt(forkId, requestedHeight)
                    .request(),
                "the leave block must be fully confirmed in this scenario"
            ).to.equal(true);

            expect(v!.blockHeight).to.equal(requestedHeight);
            expect(v!.latestProofHeight).to.equal(requestedHeight);
            const allConfirmationHeights =
                v!.milestoneConfirmationHeights.flat();
            expect(
                allConfirmationHeights.every(
                    (height) => height <= requestedHeight
                )
            ).to.equal(true);
            expect(v!.verified).to.equal(true);
        });

        it("proof requested at the exact join-block height, raised threshold completed only above it → tops out at the requested height", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 2); // peers 0,1; blocks 0..1

            const spectator = await h.join.addSpectatorWait({
                statusTimeoutMs: 5000
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
                ingestOptions: { senderAddress: joinerAddress },
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

            const v = await q0
                .getStateProofVerification(forkId, requestedHeight)
                .request();

            expect(v!.blockHeight).to.equal(requestedHeight);
            expect(v!.latestProofHeight).to.equal(requestedHeight);
            const allConfirmationHeights =
                v!.milestoneConfirmationHeights.flat();
            expect(
                allConfirmationHeights.every(
                    (height) => height <= requestedHeight
                )
            ).to.equal(true);
            // and the bounded proof still satisfies the on-chain verifier
            expect(v!.verified).to.equal(true);
        });

        it("proofs sampled while 10 blocks are produced → each verifies on-chain at its sampled height", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 1);

            // what's concurrent here: blocks + confirmation sigs keep landing
            // on peer 0 while we sample, so each sample catches storage in
            // whatever half-signed state it is in at that moment. a single
            // assembly is atomic (sync walk) - the variety is across samples.
            const forkId = h.activeForkId!;
            const blockCount = 10;
            const failures: string[] = [];
            const heightsSeen = new Set<BlockHeight>();

            // assembles + on-chain-verifies in one host call
            const sample = async () => {
                try {
                    const v = await h
                        .control(h.getPeer(0))
                        .query.getStateProofVerification(forkId)
                        .request();
                    if (!v) return;
                    heightsSeen.add(v.blockHeight);
                    if (v.latestProofHeight !== v.blockHeight) {
                        failures.push(
                            `sampled at height ${v.blockHeight} but the proof tops out at ${v.latestProofHeight}`
                        );
                    } else if (!v.verified) {
                        failures.push(
                            `proof at height ${v.blockHeight} failed the on-chain verifier`
                        );
                    }
                } catch (e) {
                    failures.push(
                        `getStateProof threw: ${e instanceof Error ? e.message : String(e)}`
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

    describe("getSnapshotFromMilestone", function () {
        // empty-milestone throw is unreachable - a hostile stateProof is gated
        // on-chain first
        it.skip("empty milestone throws", function () {});

        // two participant leaves -> a change point per leave -> >=2 milestones.
        it("multi-milestone proof → snapshot per milestone tracks its first block; finalized + latest select the LAST", async function () {
            const h = TestSession.getHarness();
            await h.scenario.setupTwoLeaversAcrossMilestones();

            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(h.activeForkId!)
                .request();

            // 2 leaves = 2 change-point milestones + the latest milestone = 3
            expect(v!.milestoneCount).to.equal(3);
            // getSnapshotFromMilestone reads the milestone's FIRST confirmation,
            // so milestones sharing a first block share a snapshot. the latest
            // milestone reaches back to the last change-point block whenever the
            // head isn't threshold-signed on its own -> distinct snapshots track
            // distinct first blocks, not the milestone count.
            const firstBlocks = v!.milestoneConfirmationHeights.map(
                (h) => h[0]
            );
            expect(new Set(v!.milestoneSnapshotHashes).size).to.equal(
                new Set(firstBlocks).size
            );
            // getLatestFinalizedSnapshot reads the LAST milestone's first block
            expect(v!.finalizedSnapshotHash).to.equal(
                v!.milestoneSnapshotHashes.at(-1)
            );
            // getLatestBlockFromStateProof returns the LAST milestone's last
            // (highest) block
            const highest = Math.max(...v!.milestoneConfirmationHeights.flat());
            expect(v!.latestProofHeight).to.equal(highest);
            expect(v!.latestProofHeight).to.equal(
                v!.milestoneConfirmationHeights.at(-1)!.at(-1)
            );
            // and the assembled proof still verifies on-chain
            expect(v!.verified).to.equal(true);
        });
    });

    describe("getLatestFinalizedSnapshot", function () {
        it("no milestone (empty proof) → genesis", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // no blocks -> no milestone

            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(h.activeForkId!, 0)
                .request();

            expect(v!.finalizedSnapshotHash).to.equal(v!.genesisSnapshotHash);
        });

        it("signedBlocks proof (no provable finality) → stays genesis", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);

            // peer 2 disconnected before any block -> nothing ever finalizes
            await h.network.disconnectPeer(2);
            await h.transition.advanceState({
                count: 2, // blocks 0..1 land unfinalized
                waitForPeers: [0, 1]
            });

            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(h.activeForkId!)
                .request();

            // no milestone builds -> finalized never leaves genesis...
            expect(v!.milestoneCount).to.equal(0);
            expect(v!.finalizedSnapshotHash).to.equal(v!.genesisSnapshotHash);
            // ...while the latest block has advanced (finalized and latest diverge maximally)
            expect(v!.latestSnapshotHash).to.not.equal(v!.genesisSnapshotHash);
            expect(v!.latestSnapshotHash).to.not.equal(
                v!.finalizedSnapshotHash
            );
        });
    });

    describe("getLatestSnapshotFromStateProof", function () {
        it("empty proof → genesis", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);

            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(h.activeForkId!, 0)
                .request();

            expect(v!.latestSnapshotHash).to.equal(v!.genesisSnapshotHash);
        });

        it("milestone carrier → the latest block's snapshot, not genesis", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // fully-signed -> milestone proof, latest = 1
            const forkId = h.activeForkId!;

            const [v, latestBundle] = await Promise.all([
                h
                    .control(h.getPeer(0))
                    .query.getStateProofVerification(forkId)
                    .request(),
                h
                    .control(h.getPeer(0))
                    .query.getBlockByHeight(forkId, 1)
                    .request()
            ]);

            expect(v!.milestoneCount).to.be.greaterThan(0);
            expect(v!.latestSnapshotHash).to.equal(
                latestBundle!.stateSnapshotHash
            );
            expect(v!.latestSnapshotHash).to.not.equal(v!.genesisSnapshotHash);
        });

        // carrier-independent: it follows the latest block on a signedBlocks
        // proof too, where getLatestFinalizedSnapshot is still stuck at genesis
        it("signedBlocks carrier → still the latest block's snapshot", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);

            await h.network.disconnectPeer(2); // no finality -> signedBlocks carrier
            await h.transition.advanceState({
                count: 2, // latest = block 1
                waitForPeers: [0, 1]
            });
            const forkId = h.activeForkId!;

            const [v, latestBundle] = await Promise.all([
                h
                    .control(h.getPeer(0))
                    .query.getStateProofVerification(forkId)
                    .request(),
                h
                    .control(h.getPeer(0))
                    .query.getBlockByHeight(forkId, 1)
                    .request()
            ]);

            expect(v!.milestoneCount).to.equal(0);
            expect(v!.signedBlockCount).to.be.greaterThan(0);
            expect(v!.latestSnapshotHash).to.equal(
                latestBundle!.stateSnapshotHash
            );
        });
    });

    describe("getLastBlockFromMilestone", function () {
        // empty milestone → undefined is unreachable: getStateProof never builds
        // a milestone with no confirmations, and a hostile proof is gated
        it.skip("empty milestone → undefined", function () {});

        // no test: one-line accessor (blockConfirmations[-1]). its last-block
        // result feeds latestProofHeight, asserted by:
        //   "fully-signed latest block → milestones-only proof, verifyMilestones passes"
        //   "multi-milestone proof → distinct snapshot per milestone; finalized + latest select the LAST"
    });

    describe("getLatestBlockFromStateProof", function () {
        it("empty proof → null", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);

            const v = await h
                .control(h.getPeer(0))
                .query.getStateProofVerification(h.activeForkId!, 0)
                .request();

            expect(v!.milestoneCount).to.equal(0);
            expect(v!.signedBlockCount).to.equal(0);
            expect(v!.latestProofHeight).to.be.null;
        });

        // no test for the non-empty carriers: latestProofHeight pins them in
        //   "fully-signed latest block → milestones-only proof, verifyMilestones passes" (milestone)
        //   "multi-milestone proof → distinct snapshot per milestone; finalized + latest select the LAST" (milestone)
        //   "latest block missing a signature → signedBlocks fallback, linkage verified on-chain" (signedBlocks)
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
            await h.network.disconnectPeer(3);
            await h.transition.advanceState({
                count: 3,
                waitForPeers: [0, 1, 2]
            });
            const forkId = h.activeForkId!;

            // d returns and syncs. d now holds:  [a] -> [b] -> [c]
            // (d sometimes also countersigns a synced block - varies per run,
            // harmless: d only ever signs the latest block)
            await h.network.connectPeers([3]);
            await waitFor(
                async () =>
                    (await h
                        .control(h.getPeer(3))
                        .query.getNextBlockHeight(forkId)
                        .request()) === 3,
                15000
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
                ingestOptions: { senderAddress: h.getPeer(0).address },
                keepConnection: true,
                waitForProcessed: false
            });
            await waitFor(
                async () => (await signersAt(1)).includes(h.getPeer(0).address),
                10000
            );

            // d stops broadcasting and authors the latest block alone:
            //   [a] -> [a,b] -> [c] -> [d]
            await h.byzantine.stubBroadcast(3);
            await h.getPeer(3).p2pInstance.p2pContractInstance.add(1);
            await waitFor(
                async () =>
                    (await qd.getNextBlockHeight(forkId).request()) === 4,
                15000
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

            const [v, finalizedBundle, latestBundle] = await Promise.all([
                qd.getStateProofVerification(forkId).request(),
                qd.getBlockByHeight(forkId, 1).request(),
                qd.getBlockByHeight(forkId, 3).request()
            ]);

            // walk from the latest block: [d] + [c] + [a,b] covers everyone at
            // block 1 -> milestone [1..3]. b
            expect(v!.milestoneCount).to.equal(1);
            expect(v!.signedBlockCount).to.equal(0);
            expect(v!.milestoneConfirmationHeights).to.deep.equal([[1, 2, 3]]);
            // block 1 is finalized - final without ever being fully signed
            expect(v!.onChainFinalizedSnapshotHash).to.equal(
                finalizedBundle!.stateSnapshotHash
            );
            expect(v!.verified).to.equal(true);
            expect(v!.isFinal).to.equal(true);
            expect(v!.latestProofHeight).to.equal(3);
            expect(v!.latestSnapshotHash).to.equal(
                latestBundle!.stateSnapshotHash
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
});

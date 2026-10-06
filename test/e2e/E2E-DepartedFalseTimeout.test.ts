import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { addressesEqual, Codec } from "@/utils";
import { hash as randomHash } from "@test/factory";
import { applyChallenges } from "@test/fixtures/ChallengeBoundaryStaging";
import {
    addFreshSpectator,
    buildFinalStateCounter,
    joinAsPendingParticipant,
    postDepartedTimeoutDispute,
    readAccusedBlock,
    readLocalFinalizedHeight,
    readWindowReduction,
    stageDepartedEligibleLeaver,
    suppressTimeoutChecks,
    waitForChainInboundHead
} from "@test/fixtures/OlderDisputeStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import type { ProofWalkInputStruct } from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import { expect } from "chai";
import { ZeroAddress } from "ethers";

describe("E2E: departed submitter's old timeout", function () {
    it("E45: a departed chain-eligible submitter's false timeout of the next author is killed by the accused block's direct threshold signatures; the reduction slashes her and keeps the accused", async function () {
        const h = TestSession.getHarness();
        const {
            forkId,
            alice,
            remaining,
            departureHeight,
            confirmExitParked,
            releaseExitPost
        } = await stageDepartedEligibleLeaver(h);
        // her parked exit post is released before the test ends
        try {
            const bob = await h.query.getNextPeerToWrite();
            const accusedHeight = departureHeight + 1;

            // Bob authors the accused block and everyone still in the channel signs it
            await h.transition.advanceState({
                count: 2,
                waitForPeers: remaining,
                waitForFinalization: true
            });
            const accused = await readAccusedBlock(
                h,
                bob.index,
                forkId,
                accusedHeight,
                alice.address
            );
            expect(addressesEqual(accused.author, bob.address)).to.equal(true);
            expect(accused.everyoneSigned).to.equal(true);
            // Alice is outside the applicable set: her signature is not needed
            expect(
                accused.requiredSigners.some((signer) =>
                    addressesEqual(signer, alice.address)
                )
            ).to.equal(false);
            expect(accused.signedByDeparted).to.equal(false);

            await confirmExitParked();
            await postDepartedTimeoutDispute(h, {
                aliceIndex: alice.index,
                accused: bob.address,
                accusedHeight,
                markMalicious: true
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType: DisputeFraudProofType.TimeoutThreshold,
                peerIndices: [bob.index]
            });
            await h.event.waitForPeers("onDisputeKilled", remaining, 1, {
                mode: "atLeast"
            });
            await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices: remaining
            });
            await h.assert.dispute.slashedOnChainExactly([alice.address]);

            // the newer disputes alone reduce: Alice slashed, no timeout, Bob kept
            const reduction = await readWindowReduction(h, bob.index, forkId);
            expect(
                reduction.disputers.some((disputer) =>
                    addressesEqual(disputer, alice.address)
                )
            ).to.equal(false);
            expect(reduction.disputers.length).to.be.greaterThan(0);
            expect(reduction.latestBlockHeight).to.equal(accusedHeight + 1);
            expect(reduction.slashedParticipants).to.deep.equal([
                alice.address
            ]);
            expect(reduction.timeoutParticipant).to.equal(ZeroAddress);
            expect(reduction.selfRemovals).to.deep.equal([]);
            expect(
                reduction.participants.some((participant) =>
                    addressesEqual(participant, bob.address)
                )
            ).to.equal(true);
            expect(
                reduction.participants.some((participant) =>
                    addressesEqual(participant, alice.address)
                )
            ).to.equal(false);
            expect(reduction.participants.length).to.equal(remaining.length);
            expect(reduction.executedReducedForkId).to.equal(
                reduction.reducedForkId
            );
            expect(reduction.reducedForkId).to.equal(
                await h.control(bob).query.getForkId().request()
            );
        } finally {
            await releaseExitPost();
        }
    });

    it("E46: a departed chain-eligible submitter's false timeout of the next author is killed by that author's qualifying posted block calldata; the reduction slashes her and keeps the accused", async function () {
        const h = TestSession.getHarness();
        const {
            forkId,
            alice,
            remaining,
            departureHeight,
            confirmExitParked,
            releaseExitPost
        } = await stageDepartedEligibleLeaver(h);
        // her parked exit post is released before the test ends
        try {
            const bob = await h.query.getNextPeerToWrite();
            const [carol, dave] = remaining.filter(
                (peerIndex) => peerIndex !== bob.index
            ) as [number, number];
            const accusedHeight = departureHeight + 1;

            // departed Alice is offline: she does not observe the posted
            // block, so her last state stays her departure
            await h
                .control(alice)
                .stub.stubHoldCalldataPostedEvents()
                .request();
            // Carol never confirms the accused block: it stays below threshold
            // and Bob posts it as calldata
            await h
                .control(h.getPeer(carol))
                .stub.stubRejectIngestedConfirmations()
                .request();
            await h.network.blacklistAndDisconnectPeer(carol);
            h.contextApi.markAfkPeer({ afkPeerIndex: carol });
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [bob.index, dave],
                waitForFinalization: false
            });
            await h.event.waitForPeers(
                "onBlockCalldataPosted",
                [bob.index, dave],
                1,
                { mode: "atLeast" }
            );
            expect(
                Number(
                    await h
                        .control(alice)
                        .query.getLatestBlockHeight(forkId)
                        .request()
                )
            ).to.equal(departureHeight);
            const accused = await readAccusedBlock(
                h,
                bob.index,
                forkId,
                accusedHeight,
                alice.address
            );
            expect(addressesEqual(accused.author, bob.address)).to.equal(true);
            expect(accused.everyoneSigned).to.equal(false);
            expect(accused.signedByDeparted).to.equal(false);
            expect(
                await h
                    .control(bob)
                    .query.getBlockCalldataTimestamp(
                        forkId,
                        accusedHeight,
                        bob.address
                    )
                    .request()
            ).to.not.equal(null);

            await confirmExitParked();
            await postDepartedTimeoutDispute(h, {
                aliceIndex: alice.index,
                accused: bob.address,
                accusedHeight,
                markMalicious: true,
                isForced: true
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutCalldataPosted,
                peerIndices: [bob.index, dave]
            });
            await h.event.waitForPeers(
                "onDisputeKilled",
                [bob.index, dave],
                1,
                {
                    mode: "atLeast"
                }
            );
            await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices: [bob.index, dave]
            });
            await h.assert.dispute.slashedOnChainExactly([alice.address]);

            // the false timeout reaches no reduction: Alice slashed, Bob kept
            const reduction = await readWindowReduction(h, bob.index, forkId);
            expect(
                reduction.disputers.some((disputer) =>
                    addressesEqual(disputer, alice.address)
                )
            ).to.equal(false);
            expect(reduction.disputers.length).to.be.greaterThan(0);
            expect(reduction.latestBlockHeight).to.equal(accusedHeight);
            expect(reduction.slashedParticipants).to.deep.equal([
                alice.address
            ]);
            expect(reduction.timeoutParticipant).to.equal(ZeroAddress);
            expect(reduction.selfRemovals).to.deep.equal([]);
            expect(
                reduction.participants.some((participant) =>
                    addressesEqual(participant, bob.address)
                )
            ).to.equal(true);
            expect(
                reduction.participants.some((participant) =>
                    addressesEqual(participant, alice.address)
                )
            ).to.equal(false);
            expect(reduction.executedReducedForkId).to.equal(
                reduction.reducedForkId
            );
            expect(reduction.reducedForkId).to.equal(
                await h.control(bob).query.getForkId().request()
            );
        } finally {
            await h.control(alice).stub.restoreCalldataPostedEvents().request();
            await releaseExitPost();
        }
    });

    it("E46 control: a departed chain-eligible submitter's honest timeout of an author who produced nothing is not killed and reaches the reduction", async function () {
        const h = TestSession.getHarness();
        const {
            forkId,
            alice,
            remaining,
            departureHeight,
            confirmExitParked,
            releaseExitPost
        } = await stageDepartedEligibleLeaver(h);
        // her parked exit post is released before the test ends
        try {
            const bob = await h.query.getNextPeerToWrite();
            const others = remaining.filter(
                (peerIndex) => peerIndex !== bob.index
            );
            const accusedHeight = departureHeight + 1;
            // Bob never authors: no block, no calldata, no counterevidence
            h.contextApi.markAfkPeer({ afkPeerIndex: bob.index });

            await confirmExitParked();
            await postDepartedTimeoutDispute(h, {
                aliceIndex: alice.index,
                accused: bob.address,
                accusedHeight,
                markMalicious: false
            });

            await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices: others,
                assertMaliciousRemoved: false
            });
            for (const peerIndex of remaining) {
                expect(
                    h.event.getEventCallCount(peerIndex, "onDisputeKilled")
                ).to.equal(0);
                expect(
                    await h
                        .control(h.getPeer(peerIndex))
                        .query.getDisputeFraudProofTypes()
                        .request()
                ).to.deep.equal([]);
            }
            await h.assert.dispute.slashedOnChainExactly([]);

            const reduction = await readWindowReduction(h, others[0]!, forkId);
            expect(
                reduction.disputers.some((disputer) =>
                    addressesEqual(disputer, alice.address)
                )
            ).to.equal(true);
            expect(
                addressesEqual(reduction.timeoutParticipant, bob.address)
            ).to.equal(true);
            expect(reduction.slashedParticipants).to.deep.equal([]);
            expect(reduction.executedReducedForkId).to.equal(
                reduction.reducedForkId
            );
            expect(reduction.reducedForkId).to.equal(
                await h
                    .control(h.getPeer(others[0]!))
                    .query.getForkId()
                    .request()
            );
        } finally {
            await releaseExitPost();
        }
    });

    it("departed Alice's false timeout of Bob at the height Carol authored is killed by a fresh pending auditor's own threshold-final state, without the departure state or Bob's calldata; the reduction slashes her and keeps Bob", async function () {
        const h = TestSession.getHarness();
        const {
            forkId,
            alice,
            remaining,
            departureHeight,
            confirmExitParked,
            releaseExitPost
        } = await stageDepartedEligibleLeaver(h);
        // her parked exit post is released before the test ends
        try {
            // her exit post parks before the auditor's join lands: a later
            // post finds an unconsumed inbound block and she self-removes
            await confirmExitParked();
            const carol = await h.query.getNextPeerToWrite();
            const bob = h.getPeer(
                remaining.find((peerIndex) => peerIndex !== carol.index)!
            );
            const accusedHeight = departureHeight + 1;
            const departureStateHash = await h
                .control(alice)
                .query.getLatestStateMachineStateHash(forkId)
                .request();
            if (departureStateHash === null)
                throw new Error("Alice holds no departure state");

            // Carol authors the accused height while the auditor syncs past it
            const auditorIndex = await addFreshSpectator(h, {
                authoringPeerIndices: remaining,
                isolateFromIndices: [alice.index]
            });
            const auditor = h.getPeer(auditorIndex);
            await suppressTimeoutChecks(h, [auditorIndex]);
            await joinAsPendingParticipant(h, auditorIndex, remaining);
            await waitForChainInboundHead(h, [
                ...remaining,
                alice.index,
                auditorIndex
            ]);
            const accused = await readAccusedBlock(
                h,
                carol.index,
                forkId,
                accusedHeight,
                alice.address
            );
            expect(addressesEqual(accused.author, carol.address)).to.equal(
                true
            );

            // the auditor trusts a final state at or above the accused height,
            // never held the departure state and holds no Bob calldata there
            expect(
                (await readLocalFinalizedHeight(h, auditorIndex, forkId)) ?? -1
            ).to.be.at.least(accusedHeight);
            expect(
                await h
                    .control(auditor)
                    .query.getStateMachineState(departureStateHash)
                    .request()
            ).to.equal(null);
            expect(
                await h
                    .control(auditor)
                    .query.getBlockCalldataTimestamp(
                        forkId,
                        accusedHeight,
                        bob.address
                    )
                    .request()
            ).to.equal(null);

            // the participants and Alice's own node hold the departure state:
            // only the auditor's counter may land
            await Promise.all(
                [...remaining, alice.index].map((peerIndex) =>
                    h.rpcStub.suppressDisputeKill(peerIndex)
                )
            );

            await postDepartedTimeoutDispute(h, {
                aliceIndex: alice.index,
                accused: bob.address,
                accusedHeight,
                markMalicious: true
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutSupersededByFinalState,
                peerIndices: [auditorIndex]
            });
            expect(
                await h
                    .control(auditor)
                    .query.getDisputeFraudProofTypes()
                    .request()
            ).to.deep.equal([
                String(
                    toSolidityDisputeFraudProofType(
                        DisputeFraudProofType.TimeoutSupersededByFinalState
                    )
                )
            ]);
            await h.event.waitForPeers("onDisputeKilled", remaining, 1, {
                mode: "atLeast"
            });
            const kill = await readDisputeKill(h, alice.address);
            expect(kill.killer).to.equal(auditor.address);
            expect(kill.appliedProofTypes).to.deep.equal([
                DisputeFraudProofType.TimeoutSupersededByFinalState
            ]);
            // the reduction seats the fresh pending auditor (its JOIN is consumed)
            await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices: [...remaining, auditorIndex]
            });
            await h.assert.dispute.slashedOnChainExactly([alice.address]);

            // the false timeout reaches no reduction: Alice slashed, Bob kept
            const reduction = await readWindowReduction(h, carol.index, forkId);
            expect(
                reduction.disputers.some((disputer) =>
                    addressesEqual(disputer, alice.address)
                )
            ).to.equal(false);
            expect(reduction.disputers.length).to.be.greaterThan(0);
            expect(reduction.slashedParticipants).to.deep.equal([
                alice.address
            ]);
            expect(reduction.timeoutParticipant).to.equal(ZeroAddress);
            expect(reduction.selfRemovals).to.deep.equal([]);
            expect(
                reduction.participants.some((participant) =>
                    addressesEqual(participant, bob.address)
                )
            ).to.equal(true);
            expect(
                reduction.participants.some((participant) =>
                    addressesEqual(participant, alice.address)
                )
            ).to.equal(false);
            // the counter needed no departure state
            expect(
                await h
                    .control(auditor)
                    .query.getStateMachineState(departureStateHash)
                    .request()
            ).to.equal(null);
            expect(
                (await auditor.p2pInstance.quiesce()).map(
                    (error) => error.message
                )
            ).to.deep.equal([]);
        } finally {
            await releaseExitPost();
        }
    });

    it("departed Alice's false timeout of Bob at the height Carol authored is not killed by a final state below the timeout height, a final proof naming another fork, or a final proof without its confirmation signatures; the challenger is slashed, and the real final state then kills it", async function () {
        const h = TestSession.getHarness();
        const {
            forkId,
            alice,
            remaining,
            departureHeight,
            confirmExitParked,
            releaseExitPost
        } = await stageDepartedEligibleLeaver(h);
        // her parked exit post is released before the test ends
        try {
            const carol = await h.query.getNextPeerToWrite();
            const [bob, dave] = remaining
                .filter((peerIndex) => peerIndex !== carol.index)
                .map((peerIndex) => h.getPeer(peerIndex));
            if (!bob || !dave) throw new Error("expected two more peers");
            const accusedHeight = departureHeight + 1;
            const proofType =
                DisputeFraudProofType.TimeoutSupersededByFinalState;

            // Carol authors the accused height and everyone left signs past it
            await h.transition.advanceState({
                count: 2,
                waitForPeers: remaining,
                waitForFinalization: true
            });
            const accused = await readAccusedBlock(
                h,
                carol.index,
                forkId,
                accusedHeight,
                alice.address
            );
            expect(addressesEqual(accused.author, carol.address)).to.equal(
                true
            );

            // Carol's real final proofs, at or above the accused height and below it
            const final = await buildFinalStateCounter(h, carol.index, forkId);
            expect(final.finalHeight).to.be.at.least(accusedHeight);
            const below = await buildFinalStateCounter(
                h,
                carol.index,
                forkId,
                departureHeight
            );
            expect(below.finalHeight).to.be.below(accusedHeight);
            const { finalProof } = Codec.decode(final.encodedProof, proofType);
            const counter = (proof: ProofWalkInputStruct) => ({
                proofType,
                encodedProof: Codec.encode({ finalProof: proof }, proofType)
            });
            const genuine = counter(finalProof);
            const controls = [
                { proofType, encodedProof: below.encodedProof },
                counter({ ...finalProof, forkId: randomHash() }),
                counter({
                    ...finalProof,
                    stateProof: {
                        milestones: finalProof.stateProof.milestones.map(
                            (milestone) => ({
                                blockConfirmations:
                                    milestone.blockConfirmations.map(
                                        (confirmation) => ({
                                            ...confirmation,
                                            signatures: []
                                        })
                                    )
                            })
                        )
                    }
                })
            ];

            // only the counters this test applies may land
            await Promise.all(
                [...remaining, alice.index].map((peerIndex) =>
                    h.rpcStub.suppressDisputeKill(peerIndex)
                )
            );
            await confirmExitParked();
            const dispute = await postDepartedTimeoutDispute(h, {
                aliceIndex: alice.index,
                accused: bob.address,
                accusedHeight,
                markMalicious: true
            });

            await applyChallenges(h, dave.index, dispute, controls, {
                markMalicious: true
            });
            expect(
                await h.channelManager.queryFilter(
                    h.channelManager.filters.DisputeKilled(h.channelId)
                )
            ).to.have.length(0);
            await h.assert.dispute.slashedOnChainExactly([dave.address]);

            // the dispute is still committed: Carol's real final state kills it
            await applyChallenges(h, carol.index, dispute, [genuine], {
                markMalicious: false
            });
            const kill = await readDisputeKill(h, alice.address);
            expect(kill.killer).to.equal(carol.address);
            expect(kill.appliedProofTypes).to.deep.equal([proofType]);
            await h.assert.dispute.slashedOnChainExactly([
                dave.address,
                alice.address
            ]);

            // each control alone is no same-fork final state at or above the
            // timeout height; the real one is
            for (const control of controls)
                expect(
                    await h.channelManager.isTimeoutSupersededByFinalState(
                        dispute,
                        Codec.decode(control.encodedProof, proofType)
                    )
                ).to.equal(false);
            expect(
                await h.channelManager.isTimeoutSupersededByFinalState(
                    dispute,
                    { finalProof }
                )
            ).to.equal(true);
        } finally {
            await releaseExitPost();
        }
    });
});

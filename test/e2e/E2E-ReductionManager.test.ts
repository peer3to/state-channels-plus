import { expect } from "chai";
import { id } from "ethers";

import { Status } from "@/types";
import type { ForkId } from "@/types/types";
import {
    MathTestSession as TestSession,
    sleep,
    type MathPeerTestHarness
} from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

describe("E2E: ReductionManager", function () {
    describe("ordinary reduction submission outcomes", function () {
        let h: MathPeerTestHarness;
        let sourceForkId: ForkId;
        const targetPeerIndex = 0;

        beforeEach(async function () {
            h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                timeConfig: { evidenceTime: 3 }
            });
            sourceForkId = h.activeForkId!;

            for (const peerIndex of [0, 1, 2, 3]) {
                await h
                    .control(h.getPeer(peerIndex))
                    .stub.stubHoldReductionTasks()
                    .request();
            }

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                expectedCount: 1
            });
            await sleep(h.event.evidencePeriodWaitMs(2));
        });

        it("RaceConditionDisputeAlreadyReduced completes the installed reduction as success", async function () {
            await h.rpcStub.releaseReductionWithSimulationError(
                targetPeerIndex,
                "RaceConditionDisputeAlreadyReduced"
            );
            await h.assert.dispute.reductionCompletedWait({
                sourceForkId,
                peerIndices: [targetPeerIndex]
            });
            expect(
                await h
                    .control(h.getPeer(targetPeerIndex))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
        });

        it("RaceConditionBlockHeightTooOld completes the installed reduction as success", async function () {
            await h.rpcStub.releaseReductionWithSimulationError(
                targetPeerIndex,
                "RaceConditionBlockHeightTooOld"
            );
            await h.assert.dispute.reductionCompletedWait({
                sourceForkId,
                peerIndices: [targetPeerIndex]
            });
            expect(
                await h
                    .control(h.getPeer(targetPeerIndex))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
        });

        it("RaceConditionReductionExpectationDoesntMatch aborts and rejects the operation", async function () {
            const targetPeer = h.getPeer(targetPeerIndex);
            await h.rpcStub.releaseReductionWithSimulationError(
                targetPeerIndex,
                "RaceConditionReductionExpectationDoesntMatch"
            );

            await waitFor(
                async () =>
                    (await h
                        .control(targetPeer)
                        .query.getStatus()
                        .request()) === Status.OPENED,
                20000,
                50
            );
            const hostErrors = await h.quiesceHosts();
            expect(hostErrors.map((error) => error.message)).to.satisfy(
                (messages: string[]) =>
                    messages.some((message) =>
                        message.includes(
                            "RaceConditionReductionExpectationDoesntMatch"
                        )
                    )
            );
            await TestSession.expectFirstDetachedError({
                includes: "RaceConditionReductionExpectationDoesntMatch",
                timeoutMs: 5000
            });
            expect(
                await h
                    .control(targetPeer)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()
            ).to.equal(null);
        });
    });

    it("an empty dispute set posts replacement evidence and resumes the same reduction", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });
        const targetPeer = h.getPeer(0);
        const sourceForkId = h.activeForkId!;

        for (const peer of h.peers) {
            await h
                .control(peer)
                .stub.stubSuppressDisputeInitiation()
                .request();
        }

        await h.tamper.postTamperedDispute(2, (dispute) => {
            dispute.outputSnapshotDataHash = id(
                "empty-dispute-set-invalid-output"
            );
        });
        await h.event.waitForPeers("onDisputeKilled", [targetPeer.index], 1, {
            mode: "atLeast",
            timeoutMs: 15000
        });
        await waitFor(
            async () =>
                (
                    await h.channelManager.getWindowCommitments(
                        h.channelId,
                        sourceForkId
                    )
                ).length === 0,
            10000,
            50
        );

        // The replacement dispute may include the independently elapsed block
        // timeout as evidence, so wait past the harness's full timeout window
        // before asking ReductionManager to construct it.
        await sleep(h.event.participantTimeoutWaitMs(1));
        await h.control(targetPeer).stub.restoreDisputeInitiation().request();
        await h.tamper.stubConstructDispute(0, (dispute) => {
            // This scenario is about the emptied on-chain dispute window. A
            // concurrently detected local block timeout is unrelated evidence
            // and can still be too fresh on another peer's clock, so keep the
            // replacement dispute based only on the persisted on-chain slash.
            const zeroAddress = "0x0000000000000000000000000000000000000000";
            dispute.input.timeout = {
                participant: zeroAddress,
                blockHeight: 0,
                minTimeStamp: 0,
                isForced: false,
                previousBlockProducer: zeroAddress,
                previousBlockProducerPostedCalldata: false,
                participantSignatureOnPreviousBlock: "0x"
            };
        });
        await h
            .control(targetPeer)
            .dispute.startReduction(sourceForkId)
            .request();

        await waitFor(
            async () =>
                (
                    await h.channelManager.getWindowCommitments(
                        h.channelId,
                        sourceForkId
                    )
                ).length > 0,
            15000,
            50
        );
        await waitFor(
            async () =>
                (await h
                    .control(targetPeer)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()) !== null,
            30000,
            50
        );
        expect(
            await h
                .control(targetPeer)
                .query.getCompletedReductionForkId(sourceForkId)
                .request()
        ).to.equal(await h.control(targetPeer).query.getForkId().request());
    });
});

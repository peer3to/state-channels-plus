// @spec-test-coverage-ignore: force-join block-bound staging shared by the force-join unit and E2E cases
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { ForkId } from "@/types/types";
import { waitFor } from "@test/utils/waitFor";

type HarnessPeer = ReturnType<MathPeerTestHarness["getPeer"]>;

/**
 * Wait until the pending joiner observed its own join on chain and its own
 * clock passed the agreementTime grace after that observation: blocks the
 * joiner commits from then on count toward the force-join block bound.
 */
export async function waitForceJoinCountingStarted(
    h: MathPeerTestHarness,
    joinerIndex: number
): Promise<void> {
    const joiner = h.getPeer(joinerIndex);
    let countingStartsAt: number | null = null;
    await waitFor(async () => {
        countingStartsAt = await h.execOnHost(
            joiner,
            async (sm) => sm.storage.forceJoin.getCountingStartsAt() ?? null
        );
        return countingStartsAt !== null;
    }, h.event.protocolEventTimeoutMs());
    await waitFor(
        async () =>
            (await h.control(joiner).query.getClockTimeInSeconds().request()) >=
            countingStartsAt!,
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * Keep the writer slot alive until the pending joiner has committed its
 * first block that counts toward the force-join bound. Idling through the
 * agreementTime grace after the join would leave the slot idle past
 * p2pTime + agreementTime, and the subjective time check would reject the
 * next block. Returns the joiner's tracking: the dispute fires on block
 * `countingFromHeight + participantCount + 1`.
 */
export async function authorUntilForceJoinCountingStarted(
    h: MathPeerTestHarness,
    joinerIndex: number,
    writers: number[]
) {
    const joiner = h.getPeer(joinerIndex);
    await h.transition.keepAuthoringUntil({
        until: async () =>
            (await h.execOnHost(
                joiner,
                async (sm) =>
                    sm.storage.forceJoin.getCountingFromHeight() !== undefined
            )) === true,
        waitForPeers: [...writers, joinerIndex],
        maximumBlocks: 20
    });
    return await readForceJoinBounds(h, joiner);
}

/** The joiner's force-join tracking, read on its host. */
export async function readForceJoinBounds(
    h: MathPeerTestHarness,
    joiner: HarnessPeer
) {
    return await h.execOnHost(joiner, async (sm) => {
        const forceJoin = sm.storage.forceJoin;
        return {
            submissionHeight: forceJoin.getJoinSubmissionBlockHeight() ?? null,
            countingStartsAt: forceJoin.getCountingStartsAt() ?? null,
            countingFromHeight: forceJoin.getCountingFromHeight() ?? null,
            disputeStarted: forceJoin.hasDisputeStarted(),
            latestBlockHeight:
                sm.storage.blocks.getNextBlockHeight(sm.forkId) - 1,
            timeConfig: { ...sm.timeConfig },
            participantCount: (await sm.diamondStateMachine.getParticipants())
                .length
        };
    });
}

/**
 * The joiner's force-join check run on its latest committed block, as its
 * commit runs it; returns whether the dispute started and the join marker
 * is still held.
 */
async function checkForceJoinOnLatestBlock(
    h: MathPeerTestHarness,
    joiner: HarnessPeer
) {
    return await h.execOnHost(joiner, async (sm) => {
        const block = sm.storage.blocks.getLatestBlock(sm.forkId)!;
        const participants = await sm.diamondStateMachine.getParticipants();
        await sm.membershipService.maybeInitiateForceJoinDispute(
            block,
            participants
        );
        return {
            disputeStarted: sm.storage.forceJoin.hasDisputeStarted(),
            markerRetained:
                sm.storage.forceJoin.getJoinSubmissionBlockHeight() !==
                undefined
        };
    });
}

/**
 * The real force-join block bound, end to end on one joiner. Three founders
 * omit a spectator's landed join; the joiner observes it on chain itself,
 * which starts the agreementTime grace. The founders author two blocks
 * inside that grace, then, once the joiner's clock is past it, the
 * participants + 1 blocks just below the bound, then one block at it. The
 * joiner's dispute submission is recorded only.
 *
 * `holdJoinSubmission`: the join's submission is held first and the
 * joiner's force-join check runs while the join is not on chain
 * (`beforeLanding`). A repeated check after the bound cannot submit twice.
 *
 * Returns the joiner's tracking after each phase, the first block authored
 * after the grace and the recorded submission counts.
 */
export async function runForceJoinBlockBound(
    h: MathPeerTestHarness,
    options: {
        holdJoinSubmission?: boolean;
    } = {}
) {
    const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
    const joiner = h.getPeer(prepared.joiner.index);
    const founders = [0, 1, 2];
    const authors = [...founders, joiner.index];
    const restores = await Promise.all(
        founders.map((index) => h.byzantine.stubPendingInboundInclusion(index))
    );
    const recorder = await h.rpcStub.recordDisputeSubmissions(joiner.index);
    const releaseSubmission = options.holdJoinSubmission
        ? await h.rpcStub.holdMembershipSubmission(joiner.index, "joinChannel")
        : undefined;
    const submissions = async () => (await recorder.submissions()).length;
    try {
        const join = prepared.joiner.p2pInstance.p2pSigner.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        let beforeLanding:
            | {
                  disputeStarted: boolean;
                  markerRetained: boolean;
                  submissions: number;
              }
            | undefined;
        if (releaseSubmission) {
            await waitFor(
                async () =>
                    (await h
                        .control(joiner)
                        .stub.getHeldMembershipReceiptCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            beforeLanding = {
                ...(await checkForceJoinOnLatestBlock(h, joiner)),
                submissions: await submissions()
            };
            await releaseSubmission();
        }
        if (!(await join)) throw new Error("staging: the join did not land");
        await waitFor(
            async () =>
                (await readForceJoinBounds(h, joiner)).countingStartsAt !==
                null,
            h.event.protocolEventTimeoutMs()
        );

        // fast blocks inside the grace
        await h.transition.advanceState({ count: 2, waitForPeers: authors });
        const clockAfterGraceBlocks = await h
            .control(joiner)
            .query.getClockTimeInSeconds()
            .request();
        const afterGraceBlocks = await readForceJoinBounds(h, joiner);
        if (clockAfterGraceBlocks >= afterGraceBlocks.countingStartsAt!)
            throw new Error(
                "staging: the grace ended before its blocks were committed"
            );

        await waitForceJoinCountingStarted(h, joiner.index);
        const firstCountedHeight = afterGraceBlocks.latestBlockHeight + 1;
        // the blocks before the bound: the first counted one and N - 1 more
        const bound = afterGraceBlocks.participantCount + 1;
        await h.transition.advanceState({
            count: bound,
            waitForPeers: authors
        });
        const belowBound = await readForceJoinBounds(h, joiner);
        const submissionsBelowBound = await submissions();

        await h.transition.advanceState({ waitForPeers: authors });
        await waitFor(
            async () => (await submissions()) > 0,
            h.event.protocolEventTimeoutMs()
        );
        const atBound = await readForceJoinBounds(h, joiner);
        const submissionsAtBound = await submissions();
        await checkForceJoinOnLatestBlock(h, joiner);
        return {
            beforeLanding,
            afterGraceBlocks,
            firstCountedHeight,
            bound,
            belowBound,
            submissionsBelowBound,
            atBound,
            submissionsAtBound,
            submissionsAfterRecheck: await submissions()
        };
    } finally {
        await releaseSubmission?.();
        await recorder.restore();
        await Promise.all(restores.map((restore) => restore()));
    }
}

/** Hold delivery of the first real membership read; later reads retain their normal behavior. */
export type HeldForceJoinMembershipRead = {
    entered: () => Promise<boolean>;
    release: () => Promise<boolean>;
};

export async function holdForceJoinMembershipRead(
    h: MathPeerTestHarness,
    joinerIndex: number
): Promise<HeldForceJoinMembershipRead> {
    const peer = h.getPeer(joinerIndex);
    await h.execOnHost(peer, (sm) => {
        const owner = sm.membershipService;
        const original = owner.getOnChainParticipantUnion.bind(owner);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let held = false;
        Object.defineProperties(owner, {
            forceJoinReadEntered: {
                value: false,
                writable: true,
                configurable: true
            },
            releaseForceJoinRead: { value: release, configurable: true },
            getOnChainParticipantUnion: {
                configurable: true,
                value: async () => {
                    const answer = await original();
                    if (!held) {
                        held = true;
                        Reflect.set(owner, "forceJoinReadEntered", true);
                        await gate;
                    }
                    return answer;
                }
            }
        });
        return true;
    });
    return {
        entered: () =>
            h.execOnHost(
                peer,
                (sm) =>
                    Reflect.get(
                        sm.membershipService,
                        "forceJoinReadEntered"
                    ) === true
            ),
        release: () =>
            h.execOnHost(peer, (sm) => {
                Reflect.get(sm.membershipService, "releaseForceJoinRead")?.();
                Reflect.deleteProperty(
                    sm.membershipService,
                    "getOnChainParticipantUnion"
                );
                Reflect.deleteProperty(
                    sm.membershipService,
                    "forceJoinReadEntered"
                );
                Reflect.deleteProperty(
                    sm.membershipService,
                    "releaseForceJoinRead"
                );
                return true;
            })
    };
}

/** Observe the real dispute request boundary without changing its behavior. */
export async function observeDisputeRequests(
    h: MathPeerTestHarness,
    peerIndex: number
) {
    const peer = h.getPeer(peerIndex);
    await h.execOnHost(peer, (sm) => {
        const owner = sm.disputeManager;
        if (Object.getOwnPropertyDescriptor(owner, "requestDispute"))
            throw new Error("A dispute request observer is already installed");
        const original = owner.requestDispute.bind(owner);
        const requests: string[] = [];
        Reflect.set(owner, "observedDisputeRequests", requests);
        Object.defineProperty(owner, "requestDispute", {
            configurable: true,
            value: (forkId: ForkId) => {
                requests.push(String(forkId));
                original(forkId);
            }
        });
        return true;
    });
    return {
        requests: () =>
            h.execOnHost(
                peer,
                (sm) =>
                    [
                        ...Reflect.get(
                            sm.disputeManager,
                            "observedDisputeRequests"
                        )
                    ] as string[]
            ),
        restore: () =>
            h.execOnHost(peer, (sm) => {
                Reflect.deleteProperty(sm.disputeManager, "requestDispute");
                Reflect.deleteProperty(
                    sm.disputeManager,
                    "observedDisputeRequests"
                );
                return true;
            })
    };
}

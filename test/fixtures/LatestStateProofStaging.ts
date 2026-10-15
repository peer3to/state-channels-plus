// @spec-test-coverage-ignore: staging for constructDispute's reuse of a latest-state proof
import type { MathPeerTestHarness } from "./MathPeerTestHarness";

/**
 * Peer `peerIndex` builds its state proof `blocksBehind` blocks below its
 * latest block (null: a build that failed) and constructs its dispute with
 * it. Returns how many proofs construction built itself and whether the
 * chain accepts the dispute.
 */
export async function constructDisputeWithLatestStateProof(
    h: MathPeerTestHarness,
    peerIndex: number,
    blocksBehind: number | null
) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const forkId = sm.forkId;
            const latestStateProof =
                args.blocksBehind === null
                    ? Promise.resolve(undefined)
                    : sm.agreementManager.buildStateProof(
                          forkId,
                          sm.storage.blocks.getLatestBlockHeight(forkId) -
                              args.blocksBehind
                      );
            await latestStateProof;
            // record-only: count the builds construction makes itself
            const agreementManager = sm.agreementManager;
            const buildStateProof = agreementManager.buildStateProof;
            let builds = 0;
            agreementManager.buildStateProof = (...buildArgs) => {
                builds++;
                return buildStateProof.apply(agreementManager, buildArgs);
            };
            try {
                const { dispute, auditingData } =
                    await sm.disputeManager.constructDispute(forkId, {
                        latestStateProof
                    });
                const chain = sm.stateChannelManagerContract;
                const walk = await chain.verifyMilestones.staticCall({
                    channelId: dispute.input.channelId,
                    forkId: dispute.input.forkId,
                    stateProof: dispute.input.stateProof,
                    genesisStateSnapshotData:
                        auditingData.genesisStateSnapshotData,
                    milestoneSnapshots: auditingData.milestoneSnapshots
                });
                const verified =
                    walk.valid &&
                    (await chain.isCorrectLatestState.staticCall(
                        dispute,
                        auditingData.genesisStateSnapshotData
                    ));
                return { builds, verified };
            } finally {
                agreementManager.buildStateProof = buildStateProof;
            }
        },
        { blocksBehind },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

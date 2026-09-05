// @spec-test-coverage-ignore: real kill and authoritative event recovery staging
import { expect } from "chai";
import { Codec, Type, hash } from "@/utils";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";

export async function assertKilledOpenerSubmissionRace(
    h: MathPeerTestHarness,
    closed: boolean,
    options: {
        observeSlashBeforeRefusal?: boolean;
        killAfterAcceptance?: boolean;
    } = {}
): Promise<void> {
    const { forkId, spammer, killer } =
        await h.scenario.stageUnkilledSpamDispute({
            killerIndex: 2,
            beforeDispute: async () => {
                for (const peer of h.peers) {
                    await h
                        .control(peer)
                        .stub.stubHoldReductionTasks()
                        .request();
                    if (peer.index !== 0)
                        await h
                            .control(peer)
                            .stub.stubSuppressDisputeInitiation()
                            .request();
                }
            }
        });
    const target = h.getPeer(0);
    const supporting = await h.dispute.fetchConstructedDispute(
        target.index,
        forkId
    );
    const dropped = options.observeSlashBeforeRefusal
        ? undefined
        : await h.rpcStub.dropSlashLogs(target.index);
    const recording = await h.rpcStub.recordDisputeSubmissions(target.index, {
        hold: true,
        forward: true
    });
    const attempt = h.execOnHost(target, async (sm) => {
        const service = sm.eventSyncService;
        const original = service.recoverOnChainSlashes.bind(service);
        let recoveries = 0;
        service.recoverOnChainSlashes = async (...parameters) => {
            recoveries += 1;
            return original(...parameters);
        };
        try {
            await sm.disputeManager.dispute(sm.forkId);
            return {
                recoveries,
                marker: sm.storage.disputes.didIDispute(sm.forkId)
            };
        } finally {
            service.recoverOnChainSlashes = original;
        }
    });
    try {
        await recording.waitUntilHeld();
        const first = Codec.decode(
            (await recording.submissions())[0].encodedDispute,
            Type.Dispute
        );
        expect(first.input.requireExistingDisputeWindow).to.equal(true);
        expect(first.input.onChainSlashes).to.not.include(spammer.address);
        if (options.killAfterAcceptance) {
            await recording.release();
            await attempt;
        }
        await h.execOnHost(
            killer,
            async (sm, args) => {
                const dispute = sm.storage.disputeFraudProofs
                    .getDisputeFraudProofs()
                    .find(
                        (proof) =>
                            proof.dispute.input.disputer === args.spammer &&
                            proof.dispute.input.forkId === args.forkId
                    )?.dispute;
                if (!dispute) throw new Error("The opener dispute is missing");
                await sm.disputeManager.killDispute(dispute);
            },
            { spammer: spammer.address, forkId }
        );
        await dropped?.waitUntilDropped();
        expect(
            await h.query.onChainSlashedParticipants(killer.index)
        ).to.include(spammer.address);
        if (options.observeSlashBeforeRefusal) {
            await waitFor(async () =>
                (
                    await h.execOnHost(target, (sm) =>
                        sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
                            sm.channelId
                        )
                    )
                ).includes(spammer.address)
            );
        } else {
            expect(
                await h.execOnHost(target, (sm) =>
                    sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
                        sm.channelId
                    )
                )
            ).to.not.include(spammer.address);
        }
        const [killedLog] = await h.channelManager.queryFilter(
            h.channelManager.filters.DisputeKilled(h.channelId)
        );
        if (!killedLog) throw new Error("The opener kill log is missing");
        const slashTimestamp = (await killedLog.getBlock()).timestamp;
        if (closed) {
            const created = Number(
                await h.channelManager.getDisputeWindowCreationTimestamp(
                    h.channelId,
                    forkId
                )
            );
            await waitFor(async () =>
                h.execOnHost(
                    killer,
                    async (sm, args) =>
                        Number(
                            (
                                await sm.stateChannelManagerContract.isKillPeriodExpired(
                                    sm.channelId,
                                    args.forkId
                                )
                            ).blockTimestamp
                        ) >=
                        args.created + sm.timeConfig.evidenceTime,
                    { forkId, created }
                )
            );
        }
        await recording.release();
        const result = await attempt;
        expect(result.recoveries).to.equal(closed ? 1 : 0);
        expect(result.marker).to.equal(true);
        const submissions = await recording.submissions();
        expect(submissions).to.have.length(closed ? 2 : 1);
        const last = Codec.decode(
            submissions[submissions.length - 1].encodedDispute,
            Type.Dispute
        );
        expect(last.input.requireExistingDisputeWindow).to.equal(!closed);
        if (closed) {
            expect(last.input.onChainSlashes).to.include(spammer.address);
            const recovered = await h.execOnHost(
                target,
                async (sm, args) => ({
                    before: await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipantsUpToTimestamp(
                        sm.channelId,
                        args.timestamp - 1
                    ),
                    at: await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipantsUpToTimestamp(
                        sm.channelId,
                        args.timestamp
                    ),
                    repeated: await sm.eventSyncService.recoverOnChainSlashes(
                        sm.channelId
                    ),
                    alreadyObservedSinceConstruction:
                        await sm.eventSyncService.recoverOnChainSlashes(
                            sm.channelId,
                            []
                        )
                }),
                { timestamp: slashTimestamp }
            );
            expect(recovered.before).to.not.include(spammer.address);
            expect(recovered.at).to.include(spammer.address);
            expect(recovered.repeated).to.equal(false);
            expect(recovered.alreadyObservedSinceConstruction).to.equal(true);
        } else {
            // The original opener is gone, but acceptance still supplies this
            // contribution's reason. The auditor must not depend on an opener.
            const verdict = await h
                .control(killer)
                .dispute.runDisputeValidation(submissions[0].encodedDispute)
                .request();
            expect(verdict.outcome).to.equal("returned");
            if (verdict.outcome === "returned")
                expect(verdict.isValid).to.equal(true);
        }
        if (options.killAfterAcceptance) {
            const contract = killer.p2pInstance.stateChannelManagerContract;
            const proof = {
                proofType: toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.InvalidDisputeReason
                ),
                participant: target.address,
                dispute: last,
                encodedProof: Codec.encode(
                    {
                        latestStateSnapshot:
                            supporting.auditingData.latestStateSnapshot
                    },
                    DisputeFraudProofType.InvalidDisputeReason
                )
            };
            const simulated = await contract.multicall.staticCall([
                contract.interface.encodeFunctionData(
                    "applyDisputeFraudProofs",
                    [[proof]]
                ),
                contract.interface.encodeFunctionData("getWindowCommitments", [
                    h.channelId,
                    forkId
                ])
            ]);
            const [commitments] = contract.interface.decodeFunctionResult(
                "getWindowCommitments",
                simulated[1]
            );
            expect(commitments).to.include(
                hash(Codec.encode(last, Type.Dispute))
            );
        }
        expect(
            await h.query.onChainSlashedParticipants(killer.index)
        ).to.not.include(target.address);
    } finally {
        await recording.release();
        await recording.restore();
        await dropped?.release();
        for (const peer of h.getActiveHonestPeers())
            await h.control(peer).stub.restoreReductionTasks(true).request();
    }
    await h.dispute.resolveDisputeWait({ forkId, honestPeerIndices: [0, 2] });
}

export async function assertDirectSlashRecovery(
    h: MathPeerTestHarness,
    failRead: boolean
): Promise<void> {
    await h.lifecycle.start(3, 0);
    const result = await h.execOnHost(
        h.getPeer(0),
        async (sm, args) => {
            const contract = sm.stateChannelManagerContract;
            const original = contract.getOnChainSlashedParticipants;
            if (args.failRead)
                Reflect.set(
                    contract,
                    "getOnChainSlashedParticipants",
                    async () => {
                        throw new Error("slash source unavailable");
                    }
                );
            try {
                const changed = await sm.eventSyncService.recoverOnChainSlashes(
                    sm.channelId
                );
                return { changed, error: null };
            } catch (error) {
                return {
                    changed: null,
                    error:
                        error instanceof Error ? error.message : String(error)
                };
            } finally {
                Reflect.set(
                    contract,
                    "getOnChainSlashedParticipants",
                    original
                );
            }
        },
        { failRead }
    );
    if (failRead) expect(result.error).to.contain("slash source unavailable");
    else expect(result).to.deep.equal({ changed: false, error: null });
}

export async function assertRecoveredSlashTimestampAndDedup(
    h: MathPeerTestHarness
): Promise<void> {
    const { forkId, spammer, killer } =
        await h.scenario.stageUnkilledSpamDispute({
            killerIndex: 2,
            beforeDispute: async () => {
                for (const peer of h.peers) {
                    await h
                        .control(peer)
                        .stub.stubSuppressDisputeInitiation()
                        .request();
                    await h
                        .control(peer)
                        .stub.stubHoldReductionTasks()
                        .request();
                }
            }
        });
    const target = h.getPeer(0);
    const dropped = await h.rpcStub.dropSlashLogs(0);
    try {
        await h.execOnHost(
            killer,
            async (sm, args) => {
                const proof = sm.storage.disputeFraudProofs
                    .getDisputeFraudProofs()
                    .find(
                        (candidate) =>
                            candidate.dispute.input.disputer === args.spammer &&
                            candidate.dispute.input.forkId === args.forkId
                    );
                if (!proof)
                    throw new Error("The invalid opener proof is missing");
                await sm.disputeManager.killDispute(proof.dispute);
            },
            { spammer: spammer.address, forkId }
        );
        await dropped.waitUntilDropped();
        const [log] = await h.channelManager.queryFilter(
            h.channelManager.filters.DisputeKilled(h.channelId)
        );
        const timestamp = (await log.getBlock()).timestamp;
        const result = await h.execOnHost(
            target,
            async (sm, args) => {
                const before =
                    await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
                        sm.channelId
                    );
                const changed = await sm.eventSyncService.recoverOnChainSlashes(
                    sm.channelId
                );
                const repeated =
                    await sm.eventSyncService.recoverOnChainSlashes(
                        sm.channelId
                    );
                return {
                    before,
                    changed,
                    repeated,
                    earlier:
                        await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipantsUpToTimestamp(
                            sm.channelId,
                            args.timestamp - 1
                        ),
                    at: await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipantsUpToTimestamp(
                        sm.channelId,
                        args.timestamp
                    )
                };
            },
            { timestamp }
        );
        expect(result.before).to.not.include(spammer.address);
        expect(result.changed).to.equal(true);
        expect(result.repeated).to.equal(false);
        expect(result.earlier).to.not.include(spammer.address);
        expect(
            result.at.filter((address) => address === spammer.address)
        ).to.have.length(1);
    } finally {
        await dropped.release();
        for (const peer of h.getActiveHonestPeers())
            await h.control(peer).stub.restoreReductionTasks(true).request();
    }
}

// @spec-test-coverage-ignore: DisputeManager.killDispute apply staging shared by its unit declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { RaceConditionErrorName } from "@/utils/evmErrorHandler";

/**
 * `killDispute` on the killer for the first stored dispute fraud proof.
 * Returns the rejection message, or "" when it resolved.
 */
function killStoredDispute(
    h: MathPeerTestHarness,
    killerIndex: number
): Promise<{ threw: string }> {
    return h.execOnHost(
        h.getPeer(killerIndex),
        async (sm) => {
            const proofs =
                sm.storage.disputeFraudProofs.getDisputeFraudProofs();
            let threw = "";
            try {
                await sm.disputeManager.killDispute(proofs[0].dispute);
            } catch (e) {
                threw = e instanceof Error ? e.message : String(e);
            }
            return { threw };
        },
        {},
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/**
 * An unkilled spam dispute whose killer's apply is answered at the contract
 * boundary by the real revert data of `customError` (the SDK's own decoder
 * and handler table decide the outcome). Runs `killDispute` and returns its
 * rejection, the recorded applies and the hosts' detached errors.
 */
export async function runKillWithApplyRace(
    h: MathPeerTestHarness,
    customError: RaceConditionErrorName
) {
    const { killer } = await h.scenario.stageUnkilledSpamDispute();
    const probe = await h.rpcStub.recordDisputeFraudProofApplies(killer.index, {
        failWith: { customError, at: "send" }
    });
    const { threw } = await killStoredDispute(h, killer.index);
    return {
        threw,
        applies: await probe.applies(),
        hostErrors: (await h.quiesceHosts()).map((error) => error.message)
    };
}

/**
 * An unkilled spam dispute whose killer's apply fails with a failure that is
 * no custom error, at its send or at its `wait`. Runs `killDispute` and
 * returns its rejection, the recorded applies, the hosts' detached errors and
 * the chain's slashed participants.
 */
export async function runKillWithUnrecognizedApplyFailure(
    h: MathPeerTestHarness,
    at: "send" | "wait",
    message: string
) {
    const { killer, spammer } = await h.scenario.stageUnkilledSpamDispute();
    const probe = await h.rpcStub.recordDisputeFraudProofApplies(killer.index, {
        failWith: { message, at }
    });
    const { threw } = await killStoredDispute(h, killer.index);
    return {
        threw,
        spammer,
        applies: await probe.applies(),
        hostErrors: (await h.quiesceHosts()).map((error) => error.message),
        slashed: await h.query.onChainSlashedParticipants()
    };
}

/**
 * A real late kill: the killer's `killDispute` passes its kill-period
 * pre-check inside the window and parks at the send; the send is released
 * only after the chain's kill period is over, so the real transaction meets
 * the expired period. Time is the input. Returns the kill-period state at the
 * release, `killDispute`'s rejection, the recorded applies and the chain's
 * slashed participants.
 */
export async function runKillSentAfterKillPeriod(h: MathPeerTestHarness) {
    const { killer, spammer, forkId } =
        await h.scenario.stageUnkilledSpamDispute({
            timeConfig: { evidenceTime: 6 }
        });
    const probe = await h.rpcStub.recordDisputeFraudProofApplies(killer.index, {
        hold: true
    });
    const attempt = killStoredDispute(h, killer.index);
    // observed below; keeps a failure from being an unhandled rejection meanwhile
    attempt.catch(() => undefined);
    await probe.waitUntilHeld(1);
    const { killPeriodEnd } = await h.query.killPeriod(forkId, killer.index);
    await h.event.waitUntilTimestamp(killPeriodEnd + 2);
    const periodAtRelease = await h.query.killPeriod(forkId, killer.index);
    await probe.release();
    const { threw } = await attempt;
    return {
        threw,
        spammer,
        periodAtRelease,
        applies: await probe.applies(),
        slashed: await h.query.onChainSlashedParticipants(killer.index)
    };
}

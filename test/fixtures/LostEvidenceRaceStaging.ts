import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { expect } from "chai";
import { id as hashOf } from "ethers";

/** Which observation-driven upload the case drives. */
export type LostRaceTrigger = "onChainSlashed" | "onDisputeKilled";

/**
 * Every honest observer of the same trigger uploads replacement evidence and
 * all but the first are refused, so the loser's handler must still succeed.
 * Stages the refusal at send, invokes the handler on a live session, and
 * asserts it resolved after exactly one upload attempt.
 */
export async function assertLostEvidenceRaceTolerated(
    h: MathPeerTestHarness,
    trigger: LostRaceTrigger
): Promise<void> {
    await h.lifecycle.start(3, 3);
    const observer = h.getPeer(0);
    const subject = h.getPeer(1).address;
    const recorder = await h.rpcStub.recordDisputeSubmissions(observer.index, {
        failWith: {
            customError: "RaceConditionDisputeEvidencePeriodExpired",
            at: "send"
        }
    });

    const rejected = await h.execOnHost(
        observer,
        async (sm, args) => {
            try {
                if (args.trigger === "onChainSlashed") {
                    await sm.eventHandler.onChainSlashed(
                        sm.channelId,
                        args.subject,
                        args.timestamp
                    );
                } else {
                    await sm.eventHandler.onDisputeKilled(
                        sm.channelId,
                        sm.forkId,
                        args.subject,
                        args.disputeHash,
                        args.timestamp
                    );
                }
                return "";
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        {
            trigger,
            subject,
            disputeHash: hashOf(`lost-race-${trigger}`),
            timestamp: Math.floor(Date.now() / 1000)
        }
    );

    expect({
        rejected,
        uploads: (await recorder.submissions()).length
    }).to.deep.equal({ rejected: "", uploads: 1 });
    await recorder.restore();
}

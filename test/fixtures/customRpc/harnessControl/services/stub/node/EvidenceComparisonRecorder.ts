// @spec-test-coverage-ignore: RPC fixture support exercised by owning E2E declarations.
import type DisputeManager from "@/disputeManager";
import type StateManager from "@/stateManager";
import type { ForkId, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One-shot fault for the next evidence comparison:
 * - `comparisonError`: the comparison's construction rejects.
 * - `unrecoverableInboundRun`: the comparison's own auditing-data rebuild
 *   finds its inbound run unrecoverable, so the real `constructDispute`
 *   reports partial auditing data.
 * - `hold`: the comparison's construction waits until
 *   `releaseHeldComparison`, then runs for real or rejects.
 * - `holdBuilt`: the comparison's construction runs for real, then waits
 *   until `releaseHeldComparison` before it returns its result or rejects.
 */
export type EvidenceComparisonFault =
    | "comparisonError"
    | "unrecoverableInboundRun"
    | "hold"
    | "holdBuilt";

/** How a held comparison continues: the real construction, or a rejection. */
export type HeldEvidenceComparisonRelease = "forward" | "fail";

/** How one recorded evidence-comparison construction settled. */
export type RecordedEvidenceComparison = {
    forkId: ForkId;
    outcome: "pending" | "resolved" | "rejected";
    /** Constructor name of the rejection, or null. */
    errorName: string | null;
    /** Hash of the built dispute once resolved, or null. */
    disputeHash: Hash | null;
};

/** One `DisputeManager.shouldAddOwnEvidence` call and its answer. */
export type RecordedEvidenceAudit = {
    forkId: ForkId;
    outcome: "pending" | "resolved" | "rejected";
    /** The answer once resolved, or null. */
    answer: boolean | null;
    /** Constructor name of the rejection, or null. */
    errorName: string | null;
};

/** Rejection of a comparison failed by the `comparisonError` fault. */
export class EvidenceComparisonFaultError extends Error {}
export const EVIDENCE_COMPARISON_FAULT_MESSAGE =
    "stubbed evidence comparison failure";

/**
 * Record-only probe on `DisputeManager.shouldAddOwnEvidence` (the audits
 * that ask for an evidence comparison), on the own-dispute builds made
 * inside it (the comparisons) and on the count of the other builds (the
 * builds of `dispute`). Every call is
 * forwarded. The optional fault applies to the next comparison only.
 */
export class EvidenceComparisonRecorder {
    readonly comparisons: RecordedEvidenceComparison[] = [];
    readonly audits: RecordedEvidenceAudit[] = [];
    /** Own-dispute builds outside a comparison. */
    disputeBuilds = 0;
    private fault?: EvidenceComparisonFault;
    private heldRelease?: (release: HeldEvidenceComparisonRelease) => void;
    private lastAudit?: { forkId: ForkId; dispute: DisputeStruct };
    private disputeManager?: DisputeManager;
    private restoreProbe?: () => void;
    /** Set on the async chain of every `shouldAddOwnEvidence` call. */
    private readonly auditContext = new AsyncLocalStorage<true>();
    /** Set only on the async chain of the comparison the fault targets. */
    private readonly faultContext = new AsyncLocalStorage<true>();

    install(sm: StateManager, fault?: EvidenceComparisonFault): void {
        this.restore();
        this.comparisons.splice(0);
        this.audits.splice(0);
        this.disputeBuilds = 0;
        this.lastAudit = undefined;
        this.fault = fault;
        const disputeManager = sm.disputeManager;
        const eventSync = sm.eventSyncService;
        const builder = disputeManager["disputeBuilder"];
        const build = builder["build"].bind(builder);
        const hasMoreEvidence = builder["hasMoreEvidence"].bind(builder);
        const shouldAddOwnEvidence =
            disputeManager.shouldAddOwnEvidence.bind(disputeManager);
        const loadInboundRun =
            eventSync.loadSynchronizedInboundRun.bind(eventSync);

        disputeManager.shouldAddOwnEvidence = (forkId, dispute) => {
            const recorded: RecordedEvidenceAudit = {
                forkId,
                outcome: "pending",
                answer: null,
                errorName: null
            };
            this.audits.push(recorded);
            this.lastAudit = { forkId, dispute };
            return this.auditContext
                .run(true, () => shouldAddOwnEvidence(forkId, dispute))
                .then(
                    (answer) => {
                        recorded.outcome = "resolved";
                        recorded.answer = answer;
                        return answer;
                    },
                    (error: unknown) => {
                        recorded.outcome = "rejected";
                        recorded.errorName = errorName(error);
                        throw error;
                    }
                );
        };
        this.disputeManager = disputeManager;
        // the real builds of dispute(); a reused build runs none
        builder["build"] = (forkId, inputs, proof) => {
            if (!this.auditContext.getStore()) this.disputeBuilds++;
            return build(forkId, inputs, proof);
        };
        builder["hasMoreEvidence"] = (forkId, dispute) => {
            const recorded: RecordedEvidenceComparison = {
                forkId,
                outcome: "pending",
                errorName: null,
                disputeHash: null
            };
            this.comparisons.push(recorded);
            const fault = this.fault;
            this.fault = undefined;
            const run =
                fault === "comparisonError"
                    ? Promise.reject(
                          new EvidenceComparisonFaultError(
                              EVIDENCE_COMPARISON_FAULT_MESSAGE
                          )
                      )
                    : fault === "unrecoverableInboundRun"
                      ? this.faultContext.run(true, () =>
                            hasMoreEvidence(forkId, dispute)
                        )
                      : fault === "hold"
                        ? this.held().then((release) => {
                              if (release === "fail")
                                  throw new EvidenceComparisonFaultError(
                                      EVIDENCE_COMPARISON_FAULT_MESSAGE
                                  );
                              return hasMoreEvidence(forkId, dispute);
                          })
                        : fault === "holdBuilt"
                          ? hasMoreEvidence(forkId, dispute).then(
                                async (answer) => {
                                    if ((await this.held()) === "fail")
                                        throw new EvidenceComparisonFaultError(
                                            EVIDENCE_COMPARISON_FAULT_MESSAGE
                                        );
                                    return answer;
                                }
                            )
                          : hasMoreEvidence(forkId, dispute);
            return run.then(
                (answer) => {
                    recorded.outcome = "resolved";
                    const ours = builder["built"].get(forkId)?.result.dispute;
                    recorded.disputeHash = ours
                        ? hash(Codec.encode(ours, Type.Dispute))
                        : null;
                    return answer;
                },
                (error: unknown) => {
                    recorded.outcome = "rejected";
                    recorded.errorName = errorName(error);
                    throw error;
                }
            );
        };
        eventSync.loadSynchronizedInboundRun = (...args) => {
            if (this.faultContext.getStore()) return Promise.resolve(undefined);
            return loadInboundRun(...args);
        };
        this.restoreProbe = () => {
            builder["build"] = build;
            builder["hasMoreEvidence"] = hasMoreEvidence;
            disputeManager.shouldAddOwnEvidence = shouldAddOwnEvidence;
            eventSync.loadSynchronizedInboundRun = loadInboundRun;
        };
    }

    /** Whether a comparison waits at the `hold` or `holdBuilt` fault. */
    get isHolding(): boolean {
        return this.heldRelease !== undefined;
    }

    /** Let the held comparison continue; false when none is held. */
    releaseHeldComparison(release: HeldEvidenceComparisonRelease): boolean {
        const resume = this.heldRelease;
        this.heldRelease = undefined;
        resume?.(release);
        return resume !== undefined;
    }

    /**
     * Ask `shouldAddOwnEvidence` again with the last recorded audit's fork
     * and dispute, as the next audit of that dispute would. The call is
     * recorded like any other.
     */
    async repeatLastAudit(): Promise<RecordedEvidenceAudit> {
        const last = this.lastAudit;
        const disputeManager = this.disputeManager;
        if (!last || !disputeManager)
            throw new Error("No evidence audit recorded");
        // the recorded wrapper pushes the entry synchronously
        const index = this.audits.length;
        await disputeManager
            .shouldAddOwnEvidence(last.forkId, last.dispute)
            .catch(() => undefined);
        return { ...this.audits[index] };
    }

    restore(): boolean {
        const restore = this.restoreProbe;
        this.restoreProbe = undefined;
        this.disputeManager = undefined;
        this.fault = undefined;
        // a held construction never stays parked past the probe
        this.releaseHeldComparison("forward");
        restore?.();
        return restore !== undefined;
    }

    private held(): Promise<HeldEvidenceComparisonRelease> {
        return new Promise((resolve) => {
            this.heldRelease = resolve;
        });
    }
}

const errorName = (error: unknown): string | null =>
    error instanceof Error ? error.constructor.name : null;

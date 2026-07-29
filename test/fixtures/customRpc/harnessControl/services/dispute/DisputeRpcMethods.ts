import { ZeroAddress } from "ethers";

import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import Clock from "@/Clock";
import { Codec, Type } from "@/utils";
import type { ForkId } from "@/types/types";
import type {
    DisputeStruct,
    DisputeConfirmationStruct,
    DisputeAuditingDataStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    DISPUTE_TAMPER_STRATEGIES,
    type DisputeTamperStrategy
} from "./tamperStrategies";
import type { DisputeService } from "./DisputeService";

/** Spec for installing a `constructDispute` tamper (named strategy or shipped body). */
export interface ConstructDisputeStubSpec {
    strategy?: DisputeTamperStrategy;
    /** Source of a `(dispute, args) => void` arrow; must be closure-free. */
    fnBody?: string;
    args?: Record<string, unknown>;
    autoRestore?: boolean;
}

/**
 * Dispute construction / auditing reads + tampering, executed host-side. Only
 * public endpoints live here; helpers/accessors/state are on {@link DisputeService}.
 */
export class DisputeRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: DisputeService
    ) {
        super(transport, service.p2pManager);
    }

    /** Start the real fork-scoped reduction without awaiting its shared result. */
    public startReduction(forkId: ForkId): boolean {
        void this.service.sm.reductionManager.tryReduce(forkId);
        return true;
    }

    /** Await the real fork-scoped reduction completion. */
    public async awaitReduction(forkId: ForkId): Promise<ForkId | null> {
        return (
            (await this.service.sm.reductionManager.tryReduce(forkId))
                ?.reducedForkId ?? null
        );
    }

    /** Recover missed committed-dispute logs through the production query path. */
    public recoverCommittedDisputes(forkId: ForkId): Promise<number> {
        return this.service.recoverCommittedDisputes(forkId);
    }

    public probeReductionScheduleIsolation(
        forkId: ForkId,
        triggerTimestamp: number
    ): boolean {
        this.service.sm.reductionManager.schedule(forkId, triggerTimestamp);
        this.service.sm.reductionManager.schedule(forkId, triggerTimestamp);
        return this.service.sm.reductionManager.hasOperation(forkId);
    }

    /**
     * Construct a dispute for `forkId` and return its structs ABI-encoded.
     * These are ethers/typechain structs (addresses, nested tuples) — JSON
     * serialization over the port flattens ethers `Result`s and nulls fields, so
     * we encode (`Codec.encode`) and let the harness `Codec.decode` them back to
     * plain mutable structs (the spectate sync-payload pattern).
     */
    public async constructDispute(forkId: ForkId): Promise<{
        encodedDispute: string;
        encodedDisputeConfirmation: string;
        encodedAuditingData: string;
    }> {
        const result =
            await this.service.disputeManager.constructDispute(forkId);
        return {
            encodedDispute: Codec.encode(
                result.dispute,
                Type.Dispute
            ) as string,
            encodedDisputeConfirmation: Codec.encode(
                result.disputeConfirmation,
                Type.DisputeConfirmation
            ) as string,
            encodedAuditingData: Codec.encode(
                result.auditingData,
                Type.DisputeAuditingData
            ) as string
        };
    }

    /** Recompute auditing data for a (tampered) state proof; ABI-encoded. */
    public getAuditingData(
        forkId: ForkId,
        encodedStateProof: string
    ): { isPartial: boolean; encodedAuditingData: string } {
        const { isPartial, auditingData } =
            this.service.disputeManager.getAuditingData(
                forkId,
                Codec.decode(encodedStateProof, Type.StateProof)
            );
        return {
            isPartial,
            encodedAuditingData: Codec.encode(
                auditingData,
                Type.DisputeAuditingData
            ) as string
        };
    }

    /** On-chain kill-period state for `forkId`, as this peer's chain reports it. */
    public async getKillPeriod(forkId: ForkId): Promise<{
        windowExists: boolean;
        isExpired: boolean;
        killPeriodEnd: number;
        blockTimestamp: number;
    }> {
        const sm = this.service.sm;
        const { windowExists, isExpired, killPeriodEnd, blockTimestamp } =
            await sm.stateChannelManagerContract.isKillPeriodExpired(
                sm.channelId,
                forkId
            );
        return {
            windowExists,
            isExpired,
            killPeriodEnd: Number(killPeriodEnd),
            blockTimestamp: Number(blockTimestamp)
        };
    }

    /** Genesis state-snapshot for `forkId`, encoded (`Type.StateSnapshot`), or null. */
    public getGenesisSnapshotStruct(
        forkId: ForkId
    ): { encodedSnapshot: string } | null {
        const struct = this.service.storage.stateSnapshots
            .getGenesisSnapshotByForkId(forkId)
            ?.toStruct();
        return struct
            ? {
                  encodedSnapshot: Codec.encode(
                      struct,
                      Type.StateSnapshot
                  ) as string
              }
            : null;
    }

    // ===== Tampering =====

    /**
     * Install a `constructDispute` tamper: a named host-side strategy, or a
     * closure-free `(dispute, args) => void` body shipped from the harness.
     */
    public stubConstructDispute(spec: ConstructDisputeStubSpec): boolean {
        let tamper: (
            dispute: DisputeStruct,
            disputeConfirmation: DisputeConfirmationStruct,
            auditingData: DisputeAuditingDataStruct
        ) => void | Promise<void>;
        if (spec.strategy) {
            const strategy = DISPUTE_TAMPER_STRATEGIES[spec.strategy];
            tamper = (dispute) => strategy(dispute);
        } else if (spec.fnBody) {
            // Callbacks run host-side: `(dispute, sm, args) => …`. `sm` is the
            // live host stateManager, so the body reaches every helper via
            // `sm.p2pManager.localRpc.dispute.*`. `args` carries captured values.
            const fn = new Function(`return (${spec.fnBody})`)() as (
                dispute: DisputeStruct,
                sm: typeof this.service.sm,
                args: Record<string, unknown>
            ) => void | Promise<void>;
            const args = spec.args ?? {};
            tamper = (dispute) => fn(dispute, this.service.sm, args);
        } else {
            throw new Error(
                "stubConstructDispute requires a strategy or fnBody"
            );
        }
        this.service.installConstructDisputeStub(tamper, spec.autoRestore);
        return true;
    }

    public restoreConstructDispute(): boolean {
        return this.service.restoreConstructDispute();
    }

    /** Encoded (`Type.Dispute`) disputes produced while `constructDispute` was stubbed (newest last). */
    public getTamperedDisputes(): { encodedDisputes: string[] } {
        return {
            encodedDisputes: this.service.tamperedDisputes.map(
                (d) => Codec.encode(d, Type.Dispute) as string
            )
        };
    }

    // ===== Storage mutations (dispute scenarios) =====

    /** Set this peer's force-exit flag (voluntary self-removal scenario). */
    public setForceExit(value: boolean): boolean {
        this.service.storage.forceExit.setForceExit(value);
        return true;
    }

    /** Plant a fresh timeout for `participant` at head+1 height on `forkId`. */
    public plantFreshTimeout(forkId: ForkId, participant: string): boolean {
        const latestBlock = this.service.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(`plantFreshTimeout: no latest block for ${forkId}`);
        }
        this.service.storage.timeout.storeTimeout(forkId, {
            participant,
            blockHeight: BigInt(Number(latestBlock.height) + 1),
            minTimeStamp: BigInt(Clock.getTimeInSeconds()),
            isForced: false,
            previousBlockProducer: ZeroAddress,
            previousBlockProducerPostedCalldata: false,
            participantSignatureOnPreviousBlock: "0x"
        });
        return true;
    }
}

export default DisputeRpcMethods;

// @spec-test-coverage-ignore: RPC fixture support exercised by owning unit declarations.
import { Block } from "@/models";
import type { AGuard } from "@/rpc/network/guards/AGuard";
import { WaitForSyncStatusGuard } from "@/rpc/network/guards/WaitForSyncStatusGuard";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import type StateManager from "@/stateManager";
import type { Status } from "@/types";

/** One live `onBlockConfirmation` RPC the runtime received. */
export type RecordedLiveBlockDelivery = {
    blockHash: string;
    forkId: string;
    height: number;
    /** Runtime status when the RPC arrived from the network. */
    arrivalStatus: Status;
    /** Runs through the service: the arrival, then each guard release. */
    runs: number;
    /**
     * Each call that reached queue intake: its order among all recorded
     * intakes, its run and the status then.
     */
    intakes: { sequence: number; run: number; status: Status }[];
    /** The RPC carried a request id, so a response was due. */
    request: boolean;
    /** Each response the service sent for this RPC, in order. */
    responses: { ok: boolean; error?: string }[];
};

// The private dispatcher member the probe wraps record-only.
type ResponsePath = {
    sendRpcResponseSafely(
        rpc: Rpc,
        response: RpcResponse,
        transport: unknown
    ): void;
};

/**
 * Record-only probe on the live block RPC path of one runtime: every
 * `stateTransitionService.runRPC` of `onBlockConfirmation` (the network
 * arrival and each re-run by a guard), the queue intake each run reaches and
 * each response the service sends for it. Every call is forwarded.
 * `retainedCount` reads how many RPCs the `WaitForSyncStatusGuard` still
 * retains.
 */
export class LiveBlockRetentionRecorder {
    readonly deliveries: RecordedLiveBlockDelivery[] = [];
    private restoreProbe?: () => void;
    private guard?: WaitForSyncStatusGuard;

    install(sm: StateManager): void {
        this.restore();
        const service = sm.p2pManager.localRpc.stateTransitionService;
        const queue = sm.blockQueueManager;
        const runRPC = service.runRPC;
        const responsePath = service as unknown as ResponsePath;
        const sendResponse = responsePath.sendRpcResponseSafely;
        const ingest = queue.ingestBlockConfirmation;
        const byRpc = new WeakMap<Rpc, RecordedLiveBlockDelivery>();
        let current: RecordedLiveBlockDelivery | undefined;
        let sequence = 0;
        this.guard = (Reflect.get(service, "guards") as AGuard[]).find(
            (guard) => guard instanceof WaitForSyncStatusGuard
        ) as WaitForSyncStatusGuard | undefined;
        service.runRPC = (rpc, transport) => {
            if (rpc.method !== "onBlockConfirmation")
                return runRPC.call(service, rpc, transport);
            let delivery = byRpc.get(rpc);
            if (!delivery) {
                const block = Block.fromBlockConfirmation(rpc.params[0]);
                delivery = {
                    blockHash: String(block.hash),
                    forkId: String(block.forkId),
                    height: Number(block.height),
                    arrivalStatus: sm.status,
                    runs: 0,
                    intakes: [],
                    request: rpc.requestId !== undefined,
                    responses: []
                };
                byRpc.set(rpc, delivery);
                this.deliveries.push(delivery);
            }
            delivery.runs += 1;
            // the guard chain and the endpoint run synchronously up to the
            // intake call, so `current` names the run that reaches it
            current = delivery;
            try {
                return runRPC.call(service, rpc, transport);
            } finally {
                current = undefined;
            }
        };
        queue.ingestBlockConfirmation = (...args) => {
            current?.intakes.push({
                sequence: sequence++,
                run: current.runs,
                status: sm.status
            });
            return ingest.apply(queue, args);
        };
        responsePath.sendRpcResponseSafely = function (rpc, response, ...rest) {
            byRpc.get(rpc)?.responses.push({
                ok: response.ok,
                ...(response.error === undefined
                    ? {}
                    : { error: String(response.error) })
            });
            return sendResponse.call(this, rpc, response, ...rest);
        };
        this.restoreProbe = () => {
            service.runRPC = runRPC;
            queue.ingestBlockConfirmation = ingest;
            responsePath.sendRpcResponseSafely = sendResponse;
        };
    }

    get retainedCount(): number {
        if (!this.guard) return 0;
        return (Reflect.get(this.guard, "retained") as unknown[]).length;
    }

    restore(): boolean {
        this.restoreProbe?.();
        this.restoreProbe = undefined;
        this.guard = undefined;
        this.deliveries.length = 0;
        return true;
    }
}

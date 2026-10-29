// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { HostProbeRpcMethods } from "./HostProbeRpcMethods";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";
import type { ProbeRpc } from "@test/fixtures/hostRoot/ProbeRpc";

/** What `echo` returns: the value and the runtime's signer address. */
export type ProbeEcho = { value: string; signerAddress: string };

/** What `slow` returns: the value and whether the root's drain awaited it. */
export type ProbeSlowReply = { value: string; isDrainHolding: boolean };

/** Internal probe service of the test application's host root. */
export class HostProbeService extends AInternalRpcService<HostProbeRpcMethods> {
    /** Values `echo` served, in call order. */
    public readonly echoes: string[] = [];
    /** Resolves once the root starts draining its in-flight replies. */
    private readonly drainStarted: Promise<void>;
    private isDrainSettled = false;

    constructor(
        router: InternalRpcRouter,
        public readonly application: () => ProbeRpc
    ) {
        super(router);
        let markDrainStarted!: () => void;
        this.drainStarted = new Promise<void>((resolve) => {
            markDrainStarted = resolve;
        });
        // Record-only: the root's own drain still runs unchanged.
        const drain = router.drainInFlightHandlers.bind(router);
        router.drainInFlightHandlers = (transport, timeoutMs) => {
            markDrainStarted();
            return drain(transport, timeoutMs).finally(() => {
                this.isDrainSettled = true;
            });
        };
    }

    public createRPCMethods(sender: InternalTransport) {
        return new HostProbeRpcMethods(this, sender);
    }

    /**
     * Waits until disposal reaches the in-flight reply drain, lets one task
     * run, and reports whether the drain is still waiting for this request.
     */
    public async isDrainHoldingAfterStart(): Promise<boolean> {
        await this.drainStarted;
        await new Promise((resolve) => setTimeout(resolve, 0));
        return !this.isDrainSettled;
    }
}

import type { RuntimeLifecycleService } from "./RuntimeLifecycleService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class RuntimeLifecycleRpcMethods extends AInternalRpcMethods<RuntimeLifecycleService> {
    public disposed(): void {
        this.service.receiveDisposed(this.sender);
    }

    public ready(): void {
        this.service.receiveReady(this.sender);
    }
    /**
     * Drain the host's detached promises and report any that rejected. Lets the
     * orchestrator settle host-side async work over the port instead of reaching
     * into a realm-local global — uniform whether the host is inline, in a worker,
     * or remote. Returns `SerializedError[]`.
     */
    public quiesce() {
        this.service.requireParent(this.sender);
        return this.service.quiesce();
    }
    public dispose() {
        return this.service.disposeFromParent(this.sender);
    }
}

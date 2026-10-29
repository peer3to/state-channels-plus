// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { MonitorProbeService } from "./MonitorProbeService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class MonitorProbeRpcMethods extends AInternalRpcMethods<MonitorProbeService> {
    public snapshot() {
        return this.service.snapshot();
    }
    public async disposeAndSnapshot() {
        await this.service.root.lifecycle.disposeFromParent(this.sender);
        return this.service.snapshot();
    }
}

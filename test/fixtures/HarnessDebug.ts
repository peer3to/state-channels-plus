// @spec-test-coverage-ignore: shared test harness exercised by owning mapped test declarations
import type {
    HarnessControlRpc,
    HarnessControlRpcShape
} from "./customRpc/harnessControl/HarnessControlRpc";
import type { PeerTestHarness } from "./PeerTestHarness";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";

export class HarnessDebug<
    THost extends
        P2pRuntimeHostRoot<HarnessControlRpcShape> = P2pRuntimeHostRoot<HarnessControlRpc>
> {
    constructor(private harness: PeerTestHarness<THost>) {}

    logPeerIndexMap(): void {
        console.log("[DEBUG] harness peers (index -> address):");
        for (const p of this.harness.peers) {
            console.log(`[DEBUG]   peer ${p.index} -> ${p.address}`);
        }
    }
}

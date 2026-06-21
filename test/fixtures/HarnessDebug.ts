import type { PeerTestHarness } from "./PeerTestHarness";
import type { HarnessControlRpc } from "./customRpc/harnessControl/HarnessControlRpc";

export class HarnessDebug<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(private harness: PeerTestHarness<TCustomRpc>) {}

    logPeerIndexMap(): void {
        console.log("[DEBUG] harness peers (index -> address):");
        for (const p of this.harness.peers) {
            console.log(`[DEBUG]   peer ${p.index} -> ${p.address}`);
        }
    }
}

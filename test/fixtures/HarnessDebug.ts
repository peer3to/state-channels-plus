import type { PeerTestHarness } from "./PeerTestHarness";

export class HarnessDebug {
    constructor(private harness: PeerTestHarness) {}

    logPeerIndexMap(): void {
        console.log("[DEBUG] harness peers (index -> address):");
        for (const p of this.harness.peers) {
            console.log(`[DEBUG]   peer ${p.index} -> ${p.address}`);
        }
    }
}

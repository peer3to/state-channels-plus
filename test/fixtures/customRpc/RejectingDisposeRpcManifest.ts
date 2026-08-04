import type P2PManager from "@/P2PManager";
import { HarnessControlRpc } from "./harnessControl/HarnessControlRpc";

/**
 * A real custom RPC root whose `dispose()` rejects. Proves through the public
 * lifecycle that a broken root never skips runtime teardown: the rejection is
 * captured and rethrown only after the remaining cleanup finished.
 */
export class RejectingDisposeRpc extends HarnessControlRpc {
    constructor(p2pManager: P2PManager<RejectingDisposeRpc>) {
        super(p2pManager);
    }

    public override async dispose(): Promise<void> {
        await super.dispose();
        throw new Error("root dispose boom");
    }
}

export default RejectingDisposeRpc;

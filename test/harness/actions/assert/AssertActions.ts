import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Logger } from "@/utils";
import {
    AssertCalldataActions,
    AssertDisputeActions,
    AssertRPCActions,
    AssertSnapshotActions,
    AssertSyncActions
} from ".";
import { AssertStorageActions } from "./AssertStorageActions";

export class AssertActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    public readonly calldata: AssertCalldataActions<TCustomRpc>;
    public readonly dispute: AssertDisputeActions<TCustomRpc>;
    public readonly rpc: AssertRPCActions<TCustomRpc>;
    public readonly snapshot: AssertSnapshotActions<TCustomRpc>;
    public readonly sync: AssertSyncActions<TCustomRpc>;
    public readonly storage: AssertStorageActions<TCustomRpc>;

    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
        private logger: Logger
    ) {
        this.calldata = new AssertCalldataActions(this.harness);
        this.dispute = new AssertDisputeActions(this.harness);
        this.rpc = new AssertRPCActions(this.harness);
        this.snapshot = new AssertSnapshotActions(this.harness);
        this.sync = new AssertSyncActions(this.harness);
        this.storage = new AssertStorageActions(this.harness);
    }
}

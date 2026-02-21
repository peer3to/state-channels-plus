import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import {
    AssertCalldataActions,
    AssertDisputeActions,
    AssertRPCActions,
    AssertSnapshotActions,
    AssertSyncActions
} from ".";

export class AssertActions {
    public readonly calldata: AssertCalldataActions;
    public readonly dispute: AssertDisputeActions;
    public readonly rpc: AssertRPCActions;
    public readonly snapshot: AssertSnapshotActions;
    public readonly sync: AssertSyncActions;

    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {
        this.calldata = new AssertCalldataActions(this.harness);
        this.dispute = new AssertDisputeActions(this.harness);
        this.rpc = new AssertRPCActions(this.harness);
        this.snapshot = new AssertSnapshotActions(this.harness);
        this.sync = new AssertSyncActions(this.harness);
    }
}

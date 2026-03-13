import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import {
    AssertCalldataActions,
    AssertDisputeActions,
    AssertRPCActions,
    AssertSnapshotActions,
    AssertSyncActions
} from ".";
import { AssertStorageActions } from "./AssertStorageActions";

export class AssertActions {
    public readonly calldata: AssertCalldataActions;
    public readonly dispute: AssertDisputeActions;
    public readonly rpc: AssertRPCActions;
    public readonly snapshot: AssertSnapshotActions;
    public readonly sync: AssertSyncActions;
    public readonly storage: AssertStorageActions;

    constructor(
        private harness: PeerTestHarness,
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

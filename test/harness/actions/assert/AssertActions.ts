// @spec-test-coverage-ignore: shared test harness exercised by owning mapped test declarations
import {
    AssertCalldataActions,
    AssertDisputeActions,
    AssertRPCActions,
    AssertSnapshotActions,
    AssertSyncActions
} from ".";
import { AssertStorageActions } from "./AssertStorageActions";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { Logger } from "@/utils";
import type {
    HarnessControlRpc,
    HarnessControlRpcShape
} from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class AssertActions<
    THost extends
        P2pRuntimeHostRoot<HarnessControlRpcShape> = P2pRuntimeHostRoot<HarnessControlRpc>
> {
    public readonly calldata: AssertCalldataActions<THost>;
    public readonly dispute: AssertDisputeActions<THost>;
    public readonly rpc: AssertRPCActions<THost>;
    public readonly snapshot: AssertSnapshotActions<THost>;
    public readonly sync: AssertSyncActions<THost>;
    public readonly storage: AssertStorageActions<THost>;

    constructor(
        private harness: PeerTestHarness<THost>,
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

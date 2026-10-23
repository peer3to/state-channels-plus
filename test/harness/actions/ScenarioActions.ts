// @spec-test-coverage-ignore: shared test harness exercised by owning mapped test declarations
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { Logger } from "@/utils";
import type {
    HarnessControlRpc,
    HarnessControlRpcShape
} from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class ScenarioActions<
    THost extends
        P2pRuntimeHostRoot<HarnessControlRpcShape> = P2pRuntimeHostRoot<HarnessControlRpc>
> {
    constructor(
        protected harness: PeerTestHarness<THost>,
        protected logger: Logger
    ) {}
}

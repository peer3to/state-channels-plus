import { Logger } from "@/utils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";

export class ScenarioActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        protected harness: PeerTestHarness<TCustomRpc>,
        protected logger: Logger
    ) {}
}

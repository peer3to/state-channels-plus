import { Logger } from "@/utils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class ScenarioActions {
    constructor(
        protected harness: PeerTestHarness,
        protected logger: Logger
    ) {}
}

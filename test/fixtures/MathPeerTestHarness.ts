import { MathStateMachine } from "@typechain-types";

import { DEFAULT_MATH_HARNESS_DEPLOYMENT_MODULE } from "@test/harness/core/defaultMathHarnessDeployment";
import { MathTransitionActions } from "@test/harness/actions/math/MathTransitionActions";
import { MathJoinActions } from "@test/harness/actions/math/MathJoinActions";
import { MathLifecycleActions } from "@test/harness/actions/math/MathLifecycleActions";
import { MathScenarioActions } from "@test/harness/actions/math/MathScenarioActions";
import { MathByzantineActions } from "@test/harness/actions/math/MathByzantineActions";
import { MathDisputeOrchestrator } from "@test/harness/actions/math/MathDisputeOrchestrator";
import PeerTestHarness from "./PeerTestHarness";
import { MainRpcService } from "@/rpc";

export class MathPeerTestHarness extends PeerTestHarness<
    MainRpcService,
    MathStateMachine
> {
    declare public transition: MathTransitionActions;
    declare public join: MathJoinActions;
    declare public lifecycle: MathLifecycleActions;
    declare public scenario: MathScenarioActions;
    declare public byzantine: MathByzantineActions;
    declare public dispute: MathDisputeOrchestrator;

    constructor() {
        super(DEFAULT_MATH_HARNESS_DEPLOYMENT_MODULE);
        this.transition = new MathTransitionActions(this, this.logger);
        this.join = new MathJoinActions(this);
        this.lifecycle = new MathLifecycleActions(this, this.logger);
        this.byzantine = new MathByzantineActions(this, this.logger);
        this.dispute = new MathDisputeOrchestrator(this, this.logger);
        this.scenario = new MathScenarioActions(this, this.logger);
    }
}

export type MathContract = MathStateMachine;

export default MathPeerTestHarness;

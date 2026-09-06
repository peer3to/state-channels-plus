import { TestSession } from "./TestSession";
import MathPeerTestHarness from "../../fixtures/MathPeerTestHarness";

export class MathTestSession extends TestSession {
    protected static override createHarness(): MathPeerTestHarness {
        return new MathPeerTestHarness();
    }

    static override getHarness(): MathPeerTestHarness {
        return super.getHarness() as MathPeerTestHarness;
    }
}

export default MathTestSession;

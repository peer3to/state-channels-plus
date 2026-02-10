import { HarnessBlock } from "./HarnessBlock";

export class Time {
    static wait(milliseconds: number) {
        return new HarnessBlock(async (harness) => {
            await new Promise((resolve) => setTimeout(resolve, milliseconds));
            return harness;
        });
    }
}

// @spec-test-coverage-ignore: deterministic timing for RelayerPool component tests
import sinon from "sinon";

import { RelayerPool } from "@/transport/relay/RelayerPool";
import { createLogger } from "@/utils";

export class RelayerPoolFixture {
    private sandbox = sinon.createSandbox();
    private clock?: sinon.SinonFakeTimers;

    public pool(urls: string[], randomValues: number[]): RelayerPool {
        this.clock = this.sandbox.useFakeTimers();
        let index = 0;
        this.sandbox.stub(Math, "random").callsFake(() => {
            const value =
                randomValues[Math.min(index, randomValues.length - 1)];
            index += 1;
            return value;
        });
        return new RelayerPool(
            urls,
            createLogger({}, {}, { level: "error", attachErrorListener: false })
        );
    }

    public tick(milliseconds: number): void {
        this.clock?.tick(milliseconds);
    }

    public timerCount(): number {
        return this.clock?.countTimers() ?? 0;
    }

    public cleanup(): void {
        this.sandbox.restore();
        this.clock = undefined;
    }
}

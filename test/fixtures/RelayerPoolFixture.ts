// @spec-test-coverage-ignore: deterministic timing for RelayerPool component tests

import { RelayerPool } from "@/transport/relay/RelayerPool";
import { type Logger, createLogger } from "@/utils";
import sinon from "sinon";

export class RelayerPoolFixture {
    private sandbox = sinon.createSandbox();
    private clock?: sinon.SinonFakeTimers;
    private warnSpy?: sinon.SinonSpy;

    public pool(urls: string[], randomValues: number[]): RelayerPool {
        this.clock = this.sandbox.useFakeTimers();
        let index = 0;
        this.sandbox.stub(Math, "random").callsFake(() => {
            const value =
                randomValues[Math.min(index, randomValues.length - 1)];
            index += 1;
            return value;
        });
        const logger: Logger = createLogger(
            {},
            {},
            { level: "error", attachErrorListener: false }
        );
        this.warnSpy = this.sandbox.spy(logger, "warn");
        return new RelayerPool(urls, logger);
    }

    /** The message and details of each warning the pool logged. */
    public warnings(): unknown[][] {
        return (this.warnSpy?.getCalls() ?? []).map((call) => call.args);
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
        this.warnSpy = undefined;
    }
}

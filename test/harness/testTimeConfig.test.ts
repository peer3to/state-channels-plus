import { expect } from "chai";
import {
    MIN_TEST_TIME_CONFIG,
    protocolEventTimeoutMs,
    resolveTestTimeConfig
} from "./core/testTimeConfig";

describe("test time config", () => {
    it("resolves the minimum-safe baseline", () => {
        expect(resolveTestTimeConfig()).to.deep.equal({
            p2pTime: 2,
            agreementTime: 3,
            chainFallbackTime: 3,
            evidenceTime: 6
        });
    });

    it("applies partial overrides without mutating the baseline", () => {
        const resolved = resolveTestTimeConfig({ evidenceTime: 8 });
        resolved.p2pTime = 99;

        expect(resolved.evidenceTime).to.equal(8);
        expect(MIN_TEST_TIME_CONFIG.p2pTime).to.equal(2);
    });

    it("includes first-block grace only at height zero", () => {
        const config = resolveTestTimeConfig();
        expect(protocolEventTimeoutMs(config, 0, 4)).to.equal(24000);
        expect(protocolEventTimeoutMs(config, 1, 4)).to.equal(18000);
    });
});

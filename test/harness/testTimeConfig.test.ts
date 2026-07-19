import { expect } from "chai";
import {
    MIN_TEST_TIME_CONFIG,
    protocolEventTimeoutMs,
    resolveTestTimeConfig
} from "./core/testTimeConfig";

describe("test time config", () => {
    it("resolves the minimum-safe baseline", () => {
        expect(resolveTestTimeConfig()).to.deep.equal({
            p2pTime: 1,
            agreementTime: 2,
            chainFallbackTime: 2,
            evidenceTime: 3
        });
    });

    it("applies partial overrides without mutating the baseline", () => {
        const resolved = resolveTestTimeConfig({ evidenceTime: 8 });
        resolved.p2pTime = 99;

        expect(resolved.evidenceTime).to.equal(8);
        expect(MIN_TEST_TIME_CONFIG.p2pTime).to.equal(1);
    });

    it("includes first-block grace only at height zero", () => {
        const config = resolveTestTimeConfig();
        expect(protocolEventTimeoutMs(config, 0, 4)).to.equal(15000);
        expect(protocolEventTimeoutMs(config, 1, 4)).to.equal(12000);
    });
});

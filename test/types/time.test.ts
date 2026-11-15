import { getTimeConfig } from "../../scripts/V1/deploy";
import { BLOCK_TIME_MS, deriveTimeConfig } from "@/types/time";
import {
    evidencePeriodWaitMs,
    participantTimeoutWaitMs,
    protocolEventTimeoutMs
} from "@test/harness/core/testTimeConfig";
import { expect } from "chai";

const BLOCK_SECONDS = BLOCK_TIME_MS / 1000;

describe("deriveTimeConfig", () => {
    it("derives each window as blocks times the block time plus its floor", () => {
        expect(deriveTimeConfig()).to.deep.equal({
            p2pTime: 0 * BLOCK_SECONDS + 5,
            agreementTime: 2 * BLOCK_SECONDS + 1,
            chainFallbackTime: 3 * BLOCK_SECONDS + 2,
            evidenceTime: 10 * BLOCK_SECONDS + 10
        });
    });

    it("replaces only the windows given as block counts", () => {
        const derived = deriveTimeConfig();

        expect(deriveTimeConfig({ evidenceTime: 3 })).to.deep.equal({
            ...derived,
            evidenceTime: 3 * BLOCK_SECONDS
        });
    });

    it("returns a fresh object on every call", () => {
        const first = deriveTimeConfig();
        first.p2pTime = 99;

        expect(deriveTimeConfig().p2pTime).to.equal(0 * BLOCK_SECONDS + 5);
    });

    it("deploys the derived windows when the deploy script is given none", () => {
        expect(getTimeConfig()).to.deep.equal(deriveTimeConfig());
    });

    it("deploys a window the deploy script is given in place of the derived one", () => {
        expect(getTimeConfig({ p2pTime: 7 })).to.deep.equal({
            ...deriveTimeConfig(),
            p2pTime: 7
        });
    });

    it("sizes the harness waits from the derived windows", () => {
        const config = deriveTimeConfig();
        const turn =
            config.p2pTime + config.agreementTime + config.chainFallbackTime;

        expect(participantTimeoutWaitMs(config, 0)).to.equal(
            (turn + config.evidenceTime + BLOCK_SECONDS) * 1000
        );
        expect(participantTimeoutWaitMs(config, 1)).to.equal(
            (turn + BLOCK_SECONDS) * 1000
        );
        expect(evidencePeriodWaitMs(config)).to.equal(
            (config.evidenceTime + BLOCK_SECONDS) * 1000
        );
        expect(protocolEventTimeoutMs(config)).to.equal(
            (turn + config.evidenceTime + 4 * BLOCK_SECONDS) * 1000
        );
        expect(
            protocolEventTimeoutMs(config, { withFirstBlockGrace: true })
        ).to.equal((turn + 2 * config.evidenceTime + 4 * BLOCK_SECONDS) * 1000);
    });
});

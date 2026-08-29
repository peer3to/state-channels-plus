import { MathTestSession as TestSession, sleep } from "@test/harness";
import { hash as randomHash } from "@test/factory";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: dispute validation / uploadRevert / disputerThrottle", function () {
    const expiryEvidenceTime = 2;
    // Leave enough chain time for dispute construction under parallel load.
    const activeEvidenceTime = 5;

    describe("disputer already throttled; opens NEW window", function () {
        it("second postDispute from same disputer within evidenceTime → dispute upload fails → ErrorDisputeThrottled", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 0, {
                timeConfig: { evidenceTime: activeEvidenceTime }
            });
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();
            const throttledPeer = h.getPeer(1).address;

            // First dispute — opens a new window for a junk fork, throttle is set
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });

            // Second dispute from the same peer — throttle should block it
            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.input.forkId = randomHash();
                    dispute.input.timeout.participant = ethers.ZeroAddress;
                    dispute.input.onChainSlashes = [];
                    dispute.input.selfRemoval = true;
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                const customError = expectDecodedError(
                    error,
                    "ErrorDisputeThrottled",
                    "expected ErrorDisputeThrottled"
                );
                const args = customError.errorDescription.args;
                expect(String(args.disputer).toLowerCase()).to.equal(
                    throttledPeer.toLowerCase()
                );
                // the throttle has not run out yet — that is why it reverted.
                // chai 4 rejects bigint in greaterThan, so compare as numbers.
                expect(Number(args.throttleExpiry)).to.be.greaterThan(
                    Number(args.currentTimestamp)
                );
            }
        });

        it("second postDispute from same disputer after evidenceTime → dispute upload succeeds", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 0, {
                timeConfig: { evidenceTime: expiryEvidenceTime }
            });
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();

            // First dispute — sets the throttle
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });
            await sleep((expiryEvidenceTime + 1) * 1000);

            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });
        });
    });

    describe("disputer already throttled; JOINS existing window opened by another peer", function () {
        it("postDispute reuses dispute.input.forkId from another peer's open window within evidenceTime → dispute upload fails → ErrorDisputeThrottled", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 0, {
                timeConfig: { evidenceTime: activeEvidenceTime }
            });
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();

            const throttledPeer = h.getPeer(2).address;

            // Peer 1 opens window-A on the channel — sets peer-1 throttle
            const sharedForkId = randomHash();
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = sharedForkId;
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });

            // Peer 2 opens window-B on the same channel — sets peer-2 throttle
            await h.tamper.postTamperedDispute(2, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });

            // Peer 2 now JOINS window-A (already opened by peer 1).
            // Pre-fix: throttle check is skipped on the join branch → succeeds.
            // Post-fix: throttle check runs unconditionally → reverts.
            try {
                await h.tamper.postTamperedDispute(2, (dispute) => {
                    dispute.input.forkId = sharedForkId;
                    dispute.input.timeout.participant = ethers.ZeroAddress;
                    dispute.input.onChainSlashes = [];
                    dispute.input.selfRemoval = true;
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                const customError = expectDecodedError(
                    error,
                    "ErrorDisputeThrottled",
                    "expected ErrorDisputeThrottled"
                );
                const args = customError.errorDescription.args;
                expect(String(args.disputer).toLowerCase()).to.equal(
                    throttledPeer.toLowerCase()
                );
                // the throttle has not run out yet — that is why it reverted.
                // chai 4 rejects bigint in greaterThan, so compare as numbers.
                expect(Number(args.throttleExpiry)).to.be.greaterThan(
                    Number(args.currentTimestamp)
                );
            }
        });
    });
});

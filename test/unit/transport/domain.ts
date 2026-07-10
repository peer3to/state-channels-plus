// Transport / runtime modes - subsystem domain (test/SUBSYSTEMS.md §16).
// Seam: src/transport/* + WebRTCSetupService + RUN_SDK_IN_THREAD runtimes.
//
// Scope (DOMAIN_REVIEW.md): only mocha-claimable cells live here.
// - TransportType has 3 enum values (HOLEPUNCH / WEBRTC / LOOPBACK);
//   `local` is LocalTransport (reports HOLEPUNCH) - what the mocha harness
//   actually runs on. Real DHT holepunch needs live relayers - not in CI,
//   not claimable here.
// - browser-main / browser-worker cells run OUTSIDE mocha (test/browser/
//   scripts) and cannot be claimed by scenario() - they are that harness's
//   responsibility, tracked there, not phantom gaps here.
// - offer/answer asymmetry is implicit (initiator = lower address) and
//   worker-bridge factories only exist for webrtc-in-worker - both are
//   properties of the webrtc cells below, not free axes.

import { defineDomain, product } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "transport",
    matrices: {
        modes: product({
            desc: "transport x runtime cells claimable from the mocha harness",
            axes: {
                transport: ["local", "webrtc", "loopback"],
                runtime: ["node-main", "node-worker"]
            }
        })
    }
});

export const covers = domain.covers;

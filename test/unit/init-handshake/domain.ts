// Init handshake - subsystem domain (test/SUBSYSTEMS.md §13).
// Seam: InitHandshakeService.runHandshake / handleHandshakeResponse.
//
// Mostly retag targets: E2E-InitHandshake already covers accepted,
// request-timeout, response-time-skew, corrupt-signature, duplicate-ack and
// the webrtc upgrade. Net-new cells: blacklisted-signer, both ackTimeout
// branches, and an explicit postHandshakeSync assertion.

import { defineDomain, variants } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "init-handshake",
    matrices: {
        handshake: variants({
            desc: "challenge verification and finalization branches",
            fields: {
                outcome: [
                    "accepted",
                    "request-timeout",
                    "rtt-exceeded",
                    "response-time-skew",
                    "blacklisted-signer",
                    "corrupt-signature",
                    // duplicate ack -> blacklist
                    "duplicate-ack"
                ],
                // ack-timeout with a known peer address blacklists; without
                // one it can only disconnect
                ackTimeout: [
                    "known-address-blacklist",
                    "unknown-address-disconnect"
                ],
                // initiated when remote prefers WEBRTC and local address is lower
                webrtcUpgrade: ["initiated", "skipped"],
                postHandshakeSync: [
                    "participant-syncs",
                    "non-participant-skips"
                ]
            },
            unreachable: [
                {
                    field: "outcome",
                    option: "rtt-exceeded",
                    reason: "RTT is measured locally - the responder stub can't force it without also tripping the response-time-skew check, which covers the temporal rejection"
                }
            ]
        })
    }
});

export const covers = domain.covers;

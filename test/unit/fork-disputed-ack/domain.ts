// Fork-disputed acknowledgement - subsystem domain (test/SUBSYSTEMS.md §15).
// Seam: IsForkDisputedService.requestDisputeAcknowledgment /
// peerAcknowledgesDisputedFork.
//
// Mostly retag targets: E2E-IsForkDisputed covers ~85% of these cells.
// Net-new: doubleAcknowledge:self (verify reachability - who calls
// IAcknowledgeDisputedFork twice?) and the negative
// consumerCheck:respects-disputed-fork (assert NO blacklist).

import { defineDomain, variants } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "fork-disputed-ack",
    matrices: {
        acknowledgement: variants({
            desc: "ack broadcast, responses, and byzantine-build detection",
            fields: {
                requestGuard: ["first-request", "already-requested"],
                // non-ack outcomes disconnect + blacklist
                peerResponse: ["acked", "not-acked", "error", "timeout"],
                doubleAcknowledge: ["peer", "self"],
                // a peer that acked and keeps building on the fork is blacklisted
                consumerCheck: [
                    "builds-on-acked-fork-blacklisted",
                    "respects-disputed-fork"
                ]
            }
        })
    }
});

export const covers = domain.covers;

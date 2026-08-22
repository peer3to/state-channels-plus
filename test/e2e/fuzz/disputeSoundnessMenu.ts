import type MathPeerTestHarness from "@test/fixtures/MathPeerTestHarness";
import type { FuzzAction } from "./FuzzAction";

// a channel must never be reduced below this many participants (never reduce to 1)
const MIN_PARTICIPANTS = 2;

// capped at 1: after 2 reductions the doubly-reduced fork's genesis is future-dated (on-chain kill
// time + evidenceTime) -> honest blocks get rejected as invalid timestamp -> spurious 3rd dispute.
// raise to 2+ once the harness clock skew is fixed (see docs/reduced-fork-timestamp-mismatch.md).
const MAX_DISPUTES = 1;

const survivorCount = (h: MathPeerTestHarness) =>
    h.getActiveHonestPeers().length;
const disputesSoFar = (h: MathPeerTestHarness) =>
    h.peers.length - survivorCount(h);

type Attack = {
    name: string;
    corrupt: (h: MathPeerTestHarness, attacker: number) => Promise<unknown>;
};
const BYZANTINE_ATTACKS: Attack[] = [
    {
        name: "invalidStateTransition",
        corrupt: (h, attacker) =>
            h.byzantine.submitInvalidStateTransitionBlock(attacker)
    },
    {
        name: "invalidTransactionData",
        corrupt: (h, attacker) =>
            h.byzantine.submitInvalidTransactionDataBlock(attacker)
    },
    {
        name: "forgedInboundMessage",
        corrupt: (h, attacker) =>
            h.byzantine.submitForgedInboundMessageBlock(attacker)
    },
    {
        // double-sign requires the same peer to have just authored — so write first, then sign conflicting
        name: "doubleSign",
        corrupt: async (h, attacker) => {
            await h.transition.peerWrite({ peer: attacker });
            await h.byzantine.submitDoubleSignBlock(attacker);
        }
    }
];

export const DISPUTE_SOUNDNESS_MENU: FuzzAction[] = [
    {
        name: "advanceState",
        weight: 5,
        enabled: ({ h }) => survivorCount(h) >= MIN_PARTICIPANTS,
        run: async ({ h, rng }) => {
            const blocks = rng.int(1, 3);
            for (let k = 0; k < blocks; k++) {
                await h.transition.fromHonestPeersOnly((c) => c.add(1));
            }
        }
    },
    {
        name: "byzantineAttack",
        weight: 3,
        enabled: ({ h }) =>
            survivorCount(h) > MIN_PARTICIPANTS &&
            disputesSoFar(h) < MAX_DISPUTES,
        run: async ({ h, rng }) => {
            const attack = rng.pick(BYZANTINE_ATTACKS);
            const forkBefore = h.activeForkId!;
            const attacker = (await h.query.getNextPeerToWrite()).index;
            h.event.resetEventSpies();
            await attack.corrupt(h, attacker);
            // eslint-disable-next-line no-console
            console.log(
                `[fuzz]   attack=${attack.name} attacker=peer${attacker}`
            );
            await h.dispute.resolveDisputeWait({
                forkId: forkBefore
            });
            // settle the new fork before continuing (see ATTACK_CATALOG D-12)
            await h.assert.snapshot.localSnapshotsChangedWait({
                previousForkId: forkBefore
            });
            const survivors = h.getActiveHonestPeers().map((p) => p.index);
            await h.assert.sync.peersInSyncWait({
                peerIndices: survivors
            });
            await h.transition.advanceState({ waitForPeers: survivors });
        }
    }
];

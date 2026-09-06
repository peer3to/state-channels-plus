# test/e2e/E2E-DiscoveryMembership.test.ts — Test Report

> **Test file:** [test/e2e/E2E-DiscoveryMembership.test.ts](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [P2PManager.ts](../../../../implementation/source/src/P2PManager.ts.md), [LocalP2pSigner.ts](../../../../implementation/source/src/evm/signer/LocalP2pSigner.ts.md)

## Overview

Default-threaded E2E cases over real worker-hosted peers and local discovery. They observe the
discovery keys a runtime is joined to, because a close alone only pauses a peer: discovery re-dials
every peer that still shares an observed key, so ending participation has to stop observing the
keys first. The first case takes two auto-connected peers, calls the public
`disconnectFromPeers` on one, and asserts the joined-key set is empty and no connection is open;
its absence oracle then holds one agreement window and requires the peer that still observes the
key not to have dialled the leaver back. The second case re-enters through `connectToChannel` and
requires the channel key to be observed again with the peer reconnected. The third drives
`disconnectFromPeers` on a runtime that never observed a key and requires a silent no-op.

Unassigned: [`REQ-UPG-7-KQPXRE.T1.P1`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1.p1)
(channel close stops observing every discovery key before closing transports) — this suite only
drives the explicit disconnect entry point, and no declaration in the tree observes the leave/close
order on the channel-close path. The no-op case has no permutation of its own.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                        | Covers                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`E2E: discovery membership > disconnectFromPeers leaves every discovery key and no peer redials`](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts#L20) (line 20)            | [`REQ-UPG-7-KQPXRE.T1.P2`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1.p2) |
| [`E2E: discovery membership > connectToChannel after disconnectFromPeers re-observes the key and reconnects`](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts#L57) (line 57) | [`REQ-UPG-7-KQPXRE.T1.P3`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1.p3) |
| [`E2E: discovery membership > disconnectFromPeers on a runtime that observes nothing is a no-op`](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts#L80) (line 80)             | —                                                                                                                    |

# test/e2e/E2E-DiscoveryMembership.test.ts — Test Report

> **Test file:** [test/e2e/E2E-DiscoveryMembership.test.ts](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [P2PManager.ts](../../../../implementation/source/src/P2PManager.ts.md), [LocalP2pSigner.ts](../../../../implementation/source/src/evm/signer/LocalP2pSigner.ts.md), [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Overview

Default-threaded E2E cases over real worker-hosted peers and local discovery. They observe the
discovery keys a runtime is joined to, because a close alone only pauses a peer: discovery re-dials
every peer that still shares an observed key, so ending participation has to stop observing the
keys first. The first case takes two auto-connected peers, calls the public
`disconnectFromPeers` on one, and asserts the joined-key set is empty and no connection is open;
its absence oracle then holds one agreement window and requires the peer that still observes the
key not to have dialled the leaver back. The second case re-enters through `connectToChannel` and
requires the channel key to be observed again with the peer reconnected. The third drives
`disconnectFromPeers` on a runtime that never observed a key and requires a silent no-op. The
fourth reaches the same end state through the other entry point: both participants of a two-peer
channel submit `leaveChannel` on chain, so the resulting 0-participant state snapshot drives the
channel close on every peer that observes it. It requires each peer to reach `NOT_OPENED` with an
empty joined-key set, no open connection, and the other identity neither excluded nor suspended,
and holds the same one-window absence oracle against a redial. Every participant closes at the
same time there, so no peer is left observing the key to redial and the end state alone cannot
separate leave-then-close from close-then-leave. The ordering itself is therefore read from a
record-only host probe that captures how many keys the runtime still observes at each transport
close and requires exactly one close with none left; the real close runs unchanged underneath.

Unassigned: nothing from [`REQ-UPG-7-KQPXRE.T1`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1)
that this suite drives. The remaining permutations of that plan belong to other entry points:
[`REQ-UPG-7-KQPXRE.T1.P4`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1.p4)
(replacement-transport admission while no key is observed) and
[`REQ-UPG-7-KQPXRE.T1.P5`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1.p5)
(disconnect during an active rendezvous session) are not exercised here. The no-op case has no
permutation of its own.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                        | Covers                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: discovery membership > disconnectFromPeers leaves every discovery key and no peer redials`](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts#L21) (line 21)            | [`REQ-UPG-7-KQPXRE.T1.P2`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1.p2)                                                                                                                                                        |
| [`E2E: discovery membership > connectToChannel after disconnectFromPeers re-observes the key and reconnects`](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts#L58) (line 58) | [`REQ-UPG-7-KQPXRE.T1.P3`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1.p3)                                                                                                                                                        |
| [`E2E: discovery membership > disconnectFromPeers on a runtime that observes nothing is a no-op`](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts#L81) (line 81)             | —                                                                                                                                                                                                                                                                           |
| [`E2E: discovery membership > channel close leaves every discovery key and no peer redials`](../../../../../../test/e2e/E2E-DiscoveryMembership.test.ts#L97) (line 97)                  | [`REQ-UPG-7-KQPXRE.T1.P1`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre.t1.p1), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p12) |

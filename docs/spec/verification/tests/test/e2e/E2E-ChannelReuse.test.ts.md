# test/e2e/E2E-ChannelReuse.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ChannelReuse.test.ts](../../../../../../test/e2e/E2E-ChannelReuse.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [targeted-channel-join.md](../../../../specification/peer-communication/targeted-channel-join.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Six direct literal cases drive the reuse of one runtime across channels end to end on the `MathTestSession`
harness with real peers, real opens, and the public signer surface. Every case starts from
`TargetedChannelJoinFixture.unopened` — a session whose channel is derived from a label but not yet opened —
opens the first channel with two other peers, brings the subject runtime to `SYNCED` through
`connectToChannel`, and then leaves. Leaving from an observer is deliberate: the committed-participant exit
path is already covered by the runtime-port and targeted-join suites, so what is under test here is the
release itself rather than the settlement in front of it. The oracles are host-side control-port reads
(selected channel id, status, disposal) and on-chain participant reads, compared as one structure.

The six cases separate what could otherwise hide behind a single happy path. The first reaches a second
channel on the runtime that left and, in the same structural comparison, proves isolation: the reused runtime
tracks only its new channel while the peers of the old channel still hold theirs and never listed it as a
participant. The second completes two full leave/reconnect cycles, where the third target is deliberately
left unopened so that selecting it proves the id was unbound again without paying for another negotiated
open. The third races a leave against the observer's own initial sync: the harness holds the observer's
`applySyncResponse` after the response has arrived, the observer leaves (so its pending connect settles
`false` with the reset), and only then is the held application released. A forwarding stub counts settled
syncs so the test waits for that stale sync to finish instead of sleeping; the runtime must then still read
zero channel id and `NOT_OPENED`, and a reconnect to the same channel must return `true`, which it can only do
by running a sync of its own. That reconnect is what separates the three fences: a stale sync that settled
the re-armed latch, a stale payload that installed its state, or a latch re-armed before the reset's own
status change would each fail it or the clean-projection read. It does not observe whether the answering peer
was penalised, and it cannot place the stale work inside the reset itself, because the hold is released only
after the leave has returned. The fourth closes both: it holds the observer's sync at its application step and also parks the observer's
reset at its chain-feed drain, which runs after the channel generation is advanced and the fork retired but
before peers are dropped or storage cleared. It releases the held application while the reset is parked, waits
for that sync to settle, and reads in one host-side projection that the status is still `OPENED` (so the reset
has not finished), that no genesis snapshot was persisted for the old fork, that the responder is not
blacklisted, and that no cut was aimed at it. Connectivity is deliberately not the oracle for the cut:
discovery is still live at that point in the reset, so a disconnected peer simply reconnects and a
connectivity read would pass whether or not the sync cut it. Instead the case installs a restore-in-test
probe before releasing the sync — it wraps `disconnectConnection` and `disconnectAndBlacklistPeerByEvmAddress`
on the observer's `P2PManager`, counts only the calls aimed at the responder, delegates to the originals so
nothing about the run changes, and restores both before the drain is released — and asserts that count is
zero alongside the rest of the projection. A generation advanced after the drain, or a stale branch that
rejects its responder on any exit rather than only the persistence one, turns it red. The same probe now also
wraps the observer's `fetchAndPersistOnChainSnapshot` and counts its calls, asserted zero in that one
structure. That is the sync's **first** write — it puts the on-chain snapshot into the local EVM before any of
the payload has been verified — so the "persisted nothing" half of the case no longer rests on the payload
persistence alone: dropping the check that precedes the first write leaves the count at one and turns the
case red, where the fork-genesis read would still have passed. The fifth brings the reused runtime and a fresh partner onto a second channel, then has the partner send a real dispute-acknowledgment request naming the channel the runtime left. The runtime's local diamond still holds that channel's state, so only the channel check stands between the request and an answer. The oracle is one structure: the partner's request fails, every disconnect the runtime requested for the partner (recorded through the harness's `rpcStub.recordDisconnects`) is a plain `ALLOW` close, and the runtime records no blacklist, suspension, or strike against the partner. The close is read from the recorded tier rather than from connectivity, because discovery is live and the partner may reconnect at once. The sixth proves that an explicit shutdown of a reused runtime is still terminal. Out of scope: the
per-store clear (`StorageClear.test.ts`), the runtime projection immediately after the reset
(`StateManagerChannelReset.test.ts`), and reuse after a _participating_ leave
(`E2E-TargetedChannelJoin.test.ts`).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Channel reuse > an observer that left reaches another channel on the same runtime`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L10) (line 10)                                      | [`REQ-LIF-10-QR8NQ9.T1.P14`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p14), [`REQ-LIF-10-QR8NQ9.T1.P15`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p15)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [`E2E: Channel reuse > one runtime completes two leave and reconnect cycles`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L53) (line 53)                                                   | [`REQ-LIF-10-QR8NQ9.T1.P12`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [`E2E: Channel reuse > a sync still in flight from the channel left neither writes into the runtime nor settles its next sync`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L91) (line 91) | [`REQ-LIF-10-QR8NQ9.T1.P17`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p17), [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P6`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p6), [`UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P11`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-handshake-routing-1-xaeym2.p11), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P34`](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p34)                                                                                                                                            |
| [`E2E: Channel reuse > a sync resuming mid-reset sees the channel already left and does not penalise its responder`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L117) (line 117)          | [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P27`](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p27), [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P7`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p7), [`REQ-LIF-10-QR8NQ9.T1.P20`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p20), [`REQ-LIF-10-QR8NQ9.T1.P21`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p21), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P30`](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p30) |
| [`E2E: Channel reuse > a peer asking about the channel the runtime left is disconnected without a verdict`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L229) (line 229)                   | [`REQ-LIF-10-QR8NQ9.T1.P35`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p35)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [`E2E: Channel reuse > explicit disposal still shuts down a runtime that was reused`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L292) (line 292)                                         | [`REQ-LIF-10-QR8NQ9.T1.P16`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

# test/e2e/E2E-ChannelReuse.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ChannelReuse.test.ts](../../../../../../test/e2e/E2E-ChannelReuse.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [targeted-channel-join.md](../../../../specification/peer-communication/targeted-channel-join.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Four direct literal cases drive the reuse of one runtime across channels end to end on the `MathTestSession`
harness with real peers, real opens, and the public signer surface. Every case starts from
`TargetedChannelJoinFixture.unopened` — a session whose channel is derived from a label but not yet opened —
opens the first channel with two other peers, brings the subject runtime to `SYNCED` through
`connectToChannel`, and then leaves. Leaving from an observer is deliberate: the committed-participant exit
path is already covered by the runtime-port and targeted-join suites, so what is under test here is the
release itself rather than the settlement in front of it. The oracles are host-side control-port reads
(selected channel id, status, disposal) and on-chain participant reads, compared as one structure.

The four cases separate what could otherwise hide behind a single happy path. The first reaches a second
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
after the leave has returned. The fourth proves that an explicit shutdown of a reused runtime is still
terminal. Out of scope: the
per-store clear (`StorageClear.test.ts`), the runtime projection immediately after the reset
(`StateManagerChannelReset.test.ts`), and reuse after a _participating_ leave
(`E2E-TargetedChannelJoin.test.ts`).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Channel reuse > an observer that left reaches another channel on the same runtime`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L9) (line 9)                                        | [`REQ-LIF-10-QR8NQ9.T1.P14`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p14), [`REQ-LIF-10-QR8NQ9.T1.P15`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p15)                                                                                                                                                                                                                                                                                                                                                                                      |
| [`E2E: Channel reuse > one runtime completes two leave and reconnect cycles`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L52) (line 52)                                                   | [`REQ-LIF-10-QR8NQ9.T1.P12`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`E2E: Channel reuse > a sync still in flight from the channel left neither writes into the runtime nor settles its next sync`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L90) (line 90) | [`REQ-LIF-10-QR8NQ9.T1.P17`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p17), [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P6`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p6), [`UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P11`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-handshake-routing-1-xaeym2.p11), [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P26`](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct.p26) |
| [`E2E: Channel reuse > explicit disposal still shuts down a runtime that was reused`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L116) (line 116)                                         | [`REQ-LIF-10-QR8NQ9.T1.P16`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

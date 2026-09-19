# test/e2e/E2E-ChannelReuse.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ChannelReuse.test.ts](../../../../../../test/e2e/E2E-ChannelReuse.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [targeted-channel-join.md](../../../../specification/peer-communication/targeted-channel-join.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Three direct literal cases drive the reuse of one runtime across channels end to end on the `MathTestSession`
harness with real peers, real opens, and the public signer surface. Every case starts from
`TargetedChannelJoinFixture.unopened` — a session whose channel is derived from a label but not yet opened —
opens the first channel with two other peers, brings the subject runtime to `SYNCED` through
`connectToChannel`, and then leaves. Leaving from an observer is deliberate: the committed-participant exit
path is already covered by the runtime-port and targeted-join suites, so what is under test here is the
release itself rather than the settlement in front of it. The oracles are host-side control-port reads
(selected channel id, status, disposal) and on-chain participant reads, compared as one structure.

The three cases separate what could otherwise hide behind a single happy path. The first reaches a second
channel on the runtime that left and, in the same structural comparison, proves isolation: the reused runtime
tracks only its new channel while the peers of the old channel still hold theirs and never listed it as a
participant. The second completes two full leave/reconnect cycles, where the third target is deliberately
left unopened so that selecting it proves the id was unbound again without paying for another negotiated
open. The third proves that an explicit shutdown of a reused runtime is still terminal. Out of scope: the
per-store clear (`StorageClear.test.ts`), the runtime projection immediately after the reset
(`StateManagerChannelReset.test.ts`), and reuse after a _participating_ leave
(`E2E-TargetedChannelJoin.test.ts`).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                            | Covers                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: Channel reuse > an observer that left reaches another channel on the same runtime`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L7) (line 7) | [`REQ-LIF-10-QR8NQ9.T1.P14`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p14), [`REQ-LIF-10-QR8NQ9.T1.P15`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p15) |
| [`E2E: Channel reuse > one runtime completes two leave and reconnect cycles`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L50) (line 50)            | [`REQ-LIF-10-QR8NQ9.T1.P12`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p12)                                                                                                           |
| [`E2E: Channel reuse > explicit disposal still shuts down a runtime that was reused`](../../../../../../test/e2e/E2E-ChannelReuse.test.ts#L88) (line 88)    | [`REQ-LIF-10-QR8NQ9.T1.P16`](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p16)                                                                                                           |

# HandshakeCompletedGuard.ts

> **Source:** [src/rpc/network/guards/HandshakeCompletedGuard.ts](../../../../../../../../src/rpc/network/guards/HandshakeCompletedGuard.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)
- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)
- [`REQ-AUTH-3-ZV74KB` (Completion requires both roles)](../../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb)
- [`REQ-UPG-2-WH7BC7` (Re-authentication before cutover)](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)

## UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX

Authenticated RPC, deferred queues, and failure routing

- Setup: Frames before, during, and after handshake across independent transports, both delivery modes, identity states, transport retirement, replacement overlap, owner disposal, and failure handlers
- Oracle: Each open authenticated transport passes; queues release only for their exact transport; stale waiters cannot replay or punish; timeout uses the exact bound; every punishment and override path has no endpoint effect

- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P1` — completed pass
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P2` — mid-negotiation queue+replay order
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P3` — real caller settles on the immediate guard error and ignores the later replay response (documents [`OQ-34-FY08V2` (RPC boundary decisions)](../../../../../../specification/open-questions.md#oq-34-fy08v2))
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P4` — non-negotiating addressed peer punished
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P5` — waiter receives `2 × agreementTime × 1000`, timeout records one strike on the peer without a verdict, and stale queued work cannot replay
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P6` — a post-timeout arrival starts a fresh waiter and replays alone on completion
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P7` — two transports have independent queues, waiters, completion, and timeout consequences
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P8` — unauthenticated profile rejects without endpoint invocation
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P9` — addressless non-negotiating and timeout branches use transport fallback disconnection
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P10` — custom failure handler runs once and suppresses built-in punishment
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P11` — closed or retired transport drops queued calls
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P12` — owner disposal drops late success
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P13` — owner disposal suppresses late failure punishment
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P14` — late completion after timeout cannot revive stale work, and the timed-out identity keeps its strike
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P15` — replaced but open authenticated transport passes during grace overlap without punishment
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P16` — replacement authentication cannot release the original queue, while original completion drains it once in FIFO order
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P17` — a late frame dispatched after authenticated transport close is dropped without execution or punishment
- [x] `UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P18` — repeated expiries on one identity suspend it at the shared bound

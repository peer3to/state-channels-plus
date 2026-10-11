# LocalOnlyGuard.ts

> **Source:** [src/rpc/network/guards/LocalOnlyGuard.ts](../../../../../../../../src/rpc/network/guards/LocalOnlyGuard.ts)

## Requirements

- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)
- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)

## UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8

Host-only admission, identity-dependent canonical punishment, and request-scoped response suppression

- Setup: Two real harness peers load the production guard on a target service and on a guard-chain service behind a real earlier guard; peer 0 receives, peer 1 calls over the real network session. Identity states are staged on real transports: an authenticated session; a negotiating transport with its real registered pre-handshake profile (the receiver holds its own handshake initiation); neither profile nor proven address, and a proven address without profile, by unregistering the real profile for the call and restoring it afterwards; a later call on the retired transport by re-injecting a captured real request frame through the network router entry point. The loopback case calls through the receiver's local RPC proxy.
- Oracle: Caller settlement (`Peer disconnected before RPC response arrived` or the declared rejection); endpoint invocations; dispatch-error log count (`onFailure` returns normally); record-only disconnect decisions with tier, reason, and origin (direct, response-failure path, or the closed transport's own close bookkeeping); profile blacklist state and stored verdict count; blacklist, suspension, and connection queries; transport closure and open-connection membership; dispatcher response attempts and response frames sent on the delivery's exact transport for each request id; `Failed to send RPC response` log count; handshake waiter calls. Forbidden: execution, deferral or replay, a guard exception, any response or response-send error for a suppressed request, a second disconnect decision from the response path.

- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P1` — trusted loopback call runs its endpoint once with no disconnect decision and no new verdict
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P2` — authenticated request with a registered profile: handler returns, no execution, profile blacklisted and address verdict recorded, transport closed and removed, one `BLACKLIST` decision, no response and no response-send error
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P3` — authenticated one-way call: handler returns, no execution, profile blacklisted, transport closed, one `BLACKLIST` decision, no response and no response-send error
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P4` — registered profile still negotiating: rejected at once with no handshake wait, no execution before or after handshake completion, no response
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P5` — no profile and no proven address: the canonical owner closes the transport only, no new verdict, no address verdict, no response
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P6` — proven address without a profile: address verdict recorded, transport closed, no execution, no response
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P7` — earlier passing guard then this guard rejects: one rejection, one `BLACKLIST` decision, no response, no execution
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P8` — earlier guard fails first: this guard never runs, no disconnect decision, the earlier guard's declared rejection response is sent unchanged
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P9` — `suppressesFailureResponse` is `true` for the exact request it rejected and `false` for a different request
- [x] `UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P10` — two overlapping rejected calls and a later call on the retired transport: every handler returns, nothing executes or waits for a handshake, profile stays blacklisted, only `BLACKLIST` decisions, no response

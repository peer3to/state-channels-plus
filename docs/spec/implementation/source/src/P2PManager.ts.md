# P2PManager.ts

> **Source:** [src/P2PManager.ts](../../../../../src/P2PManager.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md), [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

## Requirements

- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)
- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)
- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
  Partial: No cancellation beyond timeout.
- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)
  Partial: Request-style deferred retry remains unresolved in [`OQ-34-FY08V2` (RPC boundary decisions)](../../../specification/open-questions.md#oq-34-fy08v2).
- [`REQ-AUTH-5-BQG9AG` (Post-authentication engagement follows the local lifecycle)](../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag)
- [`REQ-AUTH-7-VJFSD5` (Uniform continued interaction)](../../../specification/peer-communication/handshake.md#req-auth-7-vjfsd5)
- [`REQ-LOBBY-2-TSWRV6` (Authenticated admission)](../../../specification/peer-communication/lobby-matching.md#req-lobby-2-tswrv6)
- [`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)
- [`REQ-AUTH-4-JWCF71` (Penalty requires proof, and clock faults are not proof)](../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)
- [`REQ-TRUST-5-NDVRW8` (The design targets many SMALL channels, not large ones)](../../../specification/security/trust-model.md#req-trust-5-ndvrw8)

## UNIT-TEST-P2P-MANAGER-1-9DNSRZ

Dispatch and correlation

- Setup: Send boundary, malformed, response, service, request, timeout, disconnect, foreign-peer, and transport-retirement inputs through one real runtime
- Oracle: Exact ingress consequence; each request settles once and releases its registry entry and timer; authenticated-address routing applies only while the request transport remains live

- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P1` — oversize disconnect
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P2` — response/timeout both orders
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P3` — foreign responder penalty
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P4` — late response ignored
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P5` — authenticated-address routing before retirement
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P6` — response-first classification
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P7` — malformed-envelope disconnect
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P8` — unknown-service disconnect
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P9` — response/disconnect both orders
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P10` — timeout/disconnect both orders
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P11` — unknown and duplicate responses
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P12` — exact frame limit accepted
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P13` — valid, false, and throwing service outcomes
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P14` — success, remote-error, default-error, and send-failure settlement
- [ ] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P15` — multiple pending requests rejected on disconnect
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P16` — default and explicit timeout selection
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P17` — remote-error/timeout both orders
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P18` — remote-error/disconnect both orders
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P19` — concurrent distinct and duplicate responses
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P20` — disposal rejects and releases multiple pending requests
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P21` — response/remote-error both orders
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P22` — exact-limit multibyte frame accepted and first byte over rejected
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P23` — disposal is idempotent
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P24` — throwing close still clears pending state and the connection while retaining peer identity
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P25` — retiring the original transport rejects its pending request
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P26` — bulk penalty disconnects and blacklists every peer
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P27` — valid JSON with an invalid envelope disconnects
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P28` — no participant handshake within two agreement windows aborts the uncommitted observer and settles connect as `false`
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P29` — chain genesis before any participant handshake settles the observer connect `true` without a sync request
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P30` — a false sync result arriving after chain genesis synced the runtime is ignored: no abort, status stays `SYNCED`
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P31` — abort while the initial wait is armed settles connect `false` once
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P32` — the initial deadline elapsing after chain genesis settled the wait leaves the observer `SYNCED`
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P33` — a held sync response released as a success after the abort changes neither status nor disposal
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P34` — a held sync response released as a failure after the abort changes neither status nor disposal
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P35` — an abort while the discovery join is still in flight settles connect `false` before the join returns
- [x] `UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P36` — an abort during the opened-status chain read that precedes the join still answers the pending connect `false`, delivered before the runtime's disposal closes the port

## UNIT-TEST-P2P-MANAGER-2-HR5HCB

Delivery and discovery

- Setup: Add recording network transports, broadcast one RPC, add one transport twice, and validate channel discovery-key derivation
- Oracle: Every connection receives one frame; reference duplicates do not multiply sends; channel discovery uses one valid exact bytes32 key

- [x] `UNIT-TEST-P2P-MANAGER-2-HR5HCB.P1` — broadcast fan-out
- [x] `UNIT-TEST-P2P-MANAGER-2-HR5HCB.P2` — duplicate add suppressed
- [x] `UNIT-TEST-P2P-MANAGER-2-HR5HCB.P3` — exact bytes32 channel discovery key and invalid-input rejection

## UNIT-TEST-P2P-MANAGER-3-0FEPCH

Peer registry and penalties

- Setup: Register profiles, close with each policy value including the bounded tier below and at its bound, blacklist by transport and address, try an unknown address, close a current direct transport with `ALLOW`, and snapshot known plus addressless connections
- Oracle: Only a `BLACKLIST` close records a verdict; `SUSPEND` bars the identity for the session and bans its bootstrap handle without one; the bounded tier behaves as `ALLOW` below its bound and as `SUSPEND` on the close that reaches it; an `ALLOW` close leaves standing and the bootstrap handle untouched; missing profiles are harmless; snapshots normalize known addresses and omit unknowns

- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P1` — blacklist by transport
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P2` — blacklist by address, recorded even for an address with no profile
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P3` — connected-peer normalization and unknown omission
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P4` — profile fallback deduplicates addresses and omits unknown peers
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P5` — an `ALLOW` close closes the transport and leaves the profile unexcluded and its bootstrap handle unbanned
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P6` — a `BLACKLIST` close on the same setup excludes the profile and bans its bootstrap handle
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P7` — an expected transport close reaches the switch as `ALLOW` and never excludes
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P8` — an `ALLOW` close of the current direct transport releases the upgrade preference for the bootstrap fallback
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P9` — a `SUSPEND` close bans the bootstrap handle and bars the identity without recording a verdict on the profile
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P10` — bounded-tier closes below the bound leave the identity unbarred, unbanned, and re-admittable
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P11` — the bounded-tier close that reaches the bound bars the identity and bans its handle without recording a verdict
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P12` — a barred identity dialling back is refused for the rest of the session
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P13` — bounded-tier closes of a transport that never authenticated count against its Hyperswarm key below the bound
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P14` — a suspension bars the EVM address and the Hyperswarm key together, so neither a fresh handle for the identity nor the handle under a fresh identity is admitted
- [x] `UNIT-TEST-P2P-MANAGER-3-0FEPCH.P15` — bounded-tier closes by address with no profile count and suspend that address, refusing its later authentication

## UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2

Status-driven promotion

- Setup: Complete or inject a completed handshake through the real manager under every status and lifecycle race
- Oracle: One live connection is promoted; opened alone checks participation and syncs; failures do not cause late, duplicate, or unhandled work

- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P1` — not-opened
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P2` — opened participant sync
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P3` — synced
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P4` — pending participant
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P5` — participating
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P6` — participant-read failure
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P7` — closed transport
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P8` — disposed manager
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P9` — replacement and grace retirement
- [x] `UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P10` — missing profile/transport ignored

## UNIT-TEST-P2PMANAGER-32-RX8SQP

Connected peer projection

- Setup: Register a real transport with a competing profile identity; getConnectedPeers includes the transport address and excludes the profile address.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-P2PMANAGER-32-RX8SQP.P1` — prefers a transport address over its registered profile address

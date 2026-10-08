# HolepunchBanPolicy.test.ts

Test file: [test/transport/HolepunchBanPolicy.test.ts](../../../../../../test/transport/HolepunchBanPolicy.test.ts)
Exercises: [ProfileManager](../../../../implementation/source/src/ProfileManager.ts.md)

## Overview

Uses the real manager, profile, Holepunch transport, and WebRTC transport lifecycle with typed
record-only SDK edges. The policy-release cases vary the selected transport and full live transport
set. The final three admission cases drive the public handshake-finalization path and verify
identity admission, current-transport ownership, fallback authentication, and usable socket traffic.
The fixture does not claim to execute Hyperswarm's internal network ban; the application-level rule
is exercised after a connection reaches identity proof. Rejected non-current transports also prove
that no false identity-disconnection hook fires. The disconnect-policy cases walk the whole ladder
against one real identity: a plain close, a suspension, a recorded verdict, and bounded-retry
closes driven below and up to their bound with a genuine re-admission attempt between each one. The
fresh-session cases hand the same profile to a second real manager, which is the oracle separating
session state from a recorded verdict. The pre-authentication cases drive transports that never
prove an identity, so the strike, the suspension, and the registration refusal are keyed by the
Hyperswarm key alone; one case addresses an identity with no profile at all, and the storage case
reads the recorded verdict back through a second manager over the same store.

## Tests

- `bans an explicitly blacklisted unauthenticated Holepunch profile`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P1, REQ-UPG-4-M2XDBA.T1.P5
- `drops an ordinary unauthenticated Holepunch profile without banning it`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P2, REQ-UPG-4-M2XDBA.T1.P6
- `bans the Holepunch fallback after a WebRTC upgrade`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P3, REQ-UPG-4-M2XDBA.T1.P1
- `does not release the fallback ban when a replaced WebRTC transport closes`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P4, REQ-UPG-4-M2XDBA.T1.P2
- `releases the fallback ban when the current WebRTC transport closes`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P5, REQ-UPG-4-M2XDBA.T1.P3
- `releases the fallback ban when WebRTC falls back to Holepunch`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P6
- `keeps an explicit blacklist banned when the current WebRTC transport closes`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P7, REQ-UPG-4-M2XDBA.T1.P4
- `unblacklisting with selected WebRTC keeps the Holepunch ban`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P12, REQ-UPG-4-M2XDBA.T1.P10
- `unblacklisting with selected Holepunch and live WebRTC keeps the Holepunch ban`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P13, REQ-UPG-4-M2XDBA.T1.P11
- `unblacklisting with selected Holepunch and no live WebRTC releases the Holepunch ban`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P14, REQ-UPG-4-M2XDBA.T1.P12
- `rejects an authenticated Holepunch fallback while WebRTC is healthy`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P8, REQ-UPG-4-M2XDBA.T1.P7
- `accepts an authenticated usable Holepunch fallback after current WebRTC closes`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P9, REQ-UPG-4-M2XDBA.T1.P8
- `rejects and bans a later Holepunch fallback for an excluded identity`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P10, REQ-UPG-4-M2XDBA.T1.P9
- `closes an ALLOW disconnect without blacklisting or banning the peer`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P5
- `blacklists and fault-bans the peer on a BLACKLIST disconnect`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P6
- `uses ALLOW for an expected transport close`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P7
- `releases the Holepunch upgrade ban when an ALLOW disconnect closes the WebRTC transport`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P8, UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P15
- `fault-bans the peer on a SUSPEND disconnect without blacklisting it`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P9, REQ-RPC-6-E60S4J.T1.P7
- `leaves a peer reconnectable while its retry-tier closes stay below the bound`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P10
- `suspends a peer on the retry-tier close that reaches its bound`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P11, REQ-RPC-6-E60S4J.T1.P8
- `refuses a suspended peer's reconnect for the rest of the session`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P12
- `forgets a suspension in a fresh session holding the same profile`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P16
- `keeps a blacklist in a fresh session holding the same profile`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P17
- `counts retry-tier closes against the Hyperswarm key of a transport that never authenticated`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P13
- `bans the handle and refuses the same key at registration once the bound is reached`: REQ-RPC-6-E60S4J.T1.P9
- `suspends both the EVM address and the Hyperswarm key of a proven peer`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P14, REQ-RPC-6-E60S4J.T1.P10
- `counts retry-tier closes addressed to an identity with no profile and bars it at the bound`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P15
- `records the verdict with its reason and refuses the identity from a fresh manager sharing the store`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P18, REQ-RPC-6-E60S4J.T1.P11

# ProfileManager.ts

> **Source:** [src/ProfileManager.ts](../../../../../src/ProfileManager.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md), [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-ID-2-F3Y8J4` (Normalized identity comparison)](../../../specification/protocol-model/identity.md#req-id-2-f3y8j4)
- [`REQ-UPG-2-WH7BC7` (Re-authentication before cutover)](../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)
- [`REQ-UPG-4-M2XDBA` (Fallback ban and explicit exclusion)](../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba)
- [`REQ-AUTH-4-JWCF71` (Penalty requires proof, and clock faults are not proof)](../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)
- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)
- [`REQ-LOBBY-8-31BE0F` (Profile-loss recovery)](../../../specification/peer-communication/lobby-matching.md#req-lobby-8-31be0f)

## UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5

Identity continuity

- Setup: Register, upgrade transports, reconnect, exclude with case-variant addresses
- Oracle: Profiles/exclusions persist by identity; variants unify; retirement graced

- [ ] `UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P1` — case-variant unify
- [x] `UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P2` — upgrade preserves profile
- [ ] `UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P3` — exclusion survives churn
- [ ] `UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P4` — resolution returns live transport
- [ ] `UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P5` — retiring an old transport preserves the replacement
- [x] `UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P6` — current transport removal retains the identity profile when close throws
- [x] `UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P7` — final unauthenticated and authenticated loss, authentication rebinding, upgrade retirement, fallback promotion, unsubscribe, and repeated close

## UNIT-TEST-HOLEPUNCH-BAN-1-5FB896

Ban-handle and authenticated fallback lifecycle

- Setup: Use real profiles and Holepunch/WebRTC transports with typed SDK-edge recorders through the public handshake-finalization path
- Oracle: Every transport has a profile; explicit attacks ban; ordinary close removes transport access; any live direct transport suppresses authenticated fallback without a false disconnect hook; fallback becomes usable only after the last direct transport closes; explicit blacklist wins

- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P1` — unauthenticated-profile explicit ban
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P2` — ordinary unauthenticated-profile close removes transport access
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P3` — Holepunch-to-WebRTC ban
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P4` — stale WebRTC close
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P5` — current WebRTC close
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P6` — direct fallback replacement
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P7` — explicit blacklist never unbans
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P8` — healthy WebRTC rejects an authenticated Holepunch attempt without disconnecting the identity
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P9` — current WebRTC close accepts an authenticated Holepunch fallback that becomes current and sends traffic
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P10` — excluded identity rejects and bans a later authenticated Holepunch attempt without a second disconnect event
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P11` — harness policy release permits reconnect when no direct transport remains
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P12` — selected WebRTC preserves the fallback ban during policy release
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P13` — selected Holepunch with a non-preferred live WebRTC transport preserves the fallback ban during policy release
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P14` — selected Holepunch with no live WebRTC transport releases the fallback ban during policy release
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P15` — a reconnect-allowed close of the current direct transport releases only the upgrade preference
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P16` — a suspension is unknown to a fresh manager holding the same profile
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P17` — a recorded verdict is still known to a fresh manager holding the same profile
- [x] `UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P18` — a verdict is recorded in the shared storage with its reason, a fresh manager over that storage refuses the identity, and `unblacklistPeer` removes the record

## UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA

- Setup: Dispose a manager with an unauthenticated transport
- Oracle: The transport closes and its profile is removed

- [ ] `UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA.P1` — real WebRTC channel before authentication
- [x] `UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA.P2` — A throwing transport does not prevent later unpromoted transports or Holepunch from closing; repeated manager disposal shares the first failure

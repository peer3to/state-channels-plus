# P2PManager.test.ts

Test file: [test/P2PManager.test.ts](../../../../../test/P2PManager.test.ts)
Exercises: [P2PManager.ts](../../../implementation/source/src/P2PManager.ts.md)

## Overview

Register a real transport with a competing profile identity; getConnectedPeers includes the transport address and excludes the profile address.

The suite drives the real host-side manager through its custom-RPC control fixture. It covers the
ordered frame gates, UTF-8 byte boundaries, every implemented request settlement and race with
registry/timer cleanup, disconnect and disposal cleanup, original-transport retirement, bulk
penalties, broadcast, and peer-registry snapshots. The ingress probes authenticate fault senders
and prove that oversized, malformed-envelope, unknown-service, and unknown-endpoint traffic
blacklists them. A throwing local service only disconnects. The lifecycle probe also proves that a
fault on a retired authenticated transport blacklists the current address profile and closes both
transports.

The initial-sync genesis and abort cases keep the original participants authoring through the fresh
observer's spawn and the held-request window. This prevents a participant timeout from changing the
fork before the settlement behavior is exercised; protocol time values are unchanged.

## Tests

- `prefers a transport address over its registered profile address`: UNIT-TEST-P2PMANAGER-32-RX8SQP.P1
- `applies the frame-size, response, envelope, and service gates in order`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P1, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P6, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P7, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P8, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P12, REQ-RPC-1-FF89Z0.T1.P3, REQ-RPC-1-FF89Z0.T1.P4, REQ-RPC-1-FF89Z0.T1.P5, REQ-RPC-6-E60S4J.T1.P1, REQ-RPC-6-E60S4J.T1.P2, REQ-RPC-6-E60S4J.T1.P3
- `accepts an exact-limit multibyte frame and rejects the first byte over`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P22, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P27, REQ-RPC-5-CV1R1Y.T1.P1, REQ-RPC-5-CV1R1Y.T1.P5
- `keeps valid dispatches and disconnects false or throwing service dispatches`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P13
- `settles success, remote-error, default-error, and synchronous-send requests once`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P14, REQ-RPC-2-SZDTTM.T1.P1, REQ-RPC-2-SZDTTM.T1.P6, INTEGRATION-TEST-RPC-3-ZKFXGT.P1
- `uses the agreement-time default or an explicit request timeout and releases both timers`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P16, REQ-RPC-2-SZDTTM.T1.P7
- `settles the response-timeout race exactly once in both orders`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P2, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P4, REQ-RPC-2-SZDTTM.T1.P10, INTEGRATION-TEST-RPC-3-ZKFXGT.P6
- `settles the remote-error-timeout race exactly once in both orders`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P17, REQ-RPC-2-SZDTTM.T1.P13, INTEGRATION-TEST-RPC-3-ZKFXGT.P9
- `settles the response-remote-error race exactly once in both orders`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P21, REQ-RPC-2-SZDTTM.T1.P2, INTEGRATION-TEST-RPC-3-ZKFXGT.P10
- `settles the response-disconnect race exactly once in both orders`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P9, REQ-RPC-2-SZDTTM.T1.P12, INTEGRATION-TEST-RPC-3-ZKFXGT.P7
- `settles the remote-error-disconnect race exactly once in both orders`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P18, REQ-RPC-2-SZDTTM.T1.P15, INTEGRATION-TEST-RPC-3-ZKFXGT.P11
- `settles the timeout-disconnect race exactly once in both orders`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P10, REQ-RPC-2-SZDTTM.T1.P17, INTEGRATION-TEST-RPC-3-ZKFXGT.P12
- `uses distinct request IDs and settles concurrent responses once`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P19, INTEGRATION-TEST-RPC-3-ZKFXGT.P14
- `closes later unpromoted transports and Holepunch after an earlier close fails`: UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA.P2
- `rejects and releases every pending request during disposal`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P20, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P23, REQ-RPC-2-SZDTTM.T1.P19, INTEGRATION-TEST-RPC-3-ZKFXGT.P5
- `cleans pending state and retains peer identity when transport close throws`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P24, UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P6
- `original transport retirement rejects its pending request`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P25, REQ-TJOIN-4-SDPZJW.T1.P3
- `unrelated peer cannot settle pending request`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P3, REQ-RPC-2-SZDTTM.T1.P5, INTEGRATION-TEST-RPC-3-ZKFXGT.P13, REQ-TJOIN-4-SDPZJW.T1.P4
- `routes a response by peer address before retirement and ignores duplicates`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P5, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P11, REQ-RPC-2-SZDTTM.T1.P3, REQ-TJOIN-4-SDPZJW.T1.P1
- `deduplicates connections, broadcasts once, blacklists peers, and reports known addresses`: UNIT-TEST-P2P-MANAGER-2-HR5HCB.P1, UNIT-TEST-P2P-MANAGER-2-HR5HCB.P2, UNIT-TEST-P2P-MANAGER-3-0FEPCH.P1, UNIT-TEST-P2P-MANAGER-3-0FEPCH.P2, UNIT-TEST-P2P-MANAGER-3-0FEPCH.P3
- `blacklists and disconnects every peer in a bulk penalty`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P26
- `uses profile fallback, deduplicates addresses, and omits unknown peers`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P4
- `ignores a completed handshake with no registered transport`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P10, REQ-AUTH-5-BQG9AG.T1.P10
- `does not promote a transport that closed before handshake dispatch`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P7, REQ-AUTH-5-BQG9AG.T1.P7
- `does not promote a late handshake after manager disposal`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P8, REQ-AUTH-5-BQG9AG.T1.P8
- `retires a replaced handshake transport and keeps one live connection`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P9, REQ-AUTH-5-BQG9AG.T1.P9
- `emits profile loss only after the last live transport closes`: UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P7, REQ-LOBBY-8-31BE0F.T1.P1, REQ-LOBBY-8-31BE0F.T1.P2, REQ-LOBBY-8-31BE0F.T1.P4
- `initial handshake selects the two-window channel-load sync entry`: none
- `normal post-open discovery reaches channel participants`: none
- `provider open event switches targeted matching to raw channel discovery`: none
- `unopened target without autoOpen leaves raw and matching discovery untouched`: INV-TJOIN-1-R3K75D.T1.P1
- `targeted matching keeps the selected channel without entering DISCOVERING`: INV-TJOIN-1-R3K75D.T1.P4
- `targeted matching probe settles after the derived topic is joined`: none
- `unsigned targeted failure retains the target and blacklists neither peer`: UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P1, REQ-TJOIN-5-Q795M7.T1.P11
- `explicit same-ID retry creates a fresh matcher and negotiation attempt`: UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P2, REQ-TJOIN-5-Q795M7.T1.P2
- `fatal initial sync closes its root and rejects later same-channel client calls`: UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P3, REQ-TJOIN-5-Q795M7.T1.P4
- `observer connect resolves false when no participant handshake completes within the initial window`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P28, REQ-TJOIN-3-DCZKS6.T1.P6
- `observer connect resolves true when chain genesis lands before any participant handshake`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P29, REQ-TJOIN-3-DCZKS6.T1.P7
- `observer stays synced when the initial deadline elapses after chain genesis settled the wait`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P32
- `observer ignores a stale false sync result once chain genesis already synced it`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P30, REQ-TJOIN-3-DCZKS6.T1.P8
- `observer connect resolves false when the runtime aborts while the initial wait is armed`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P31
- `observer connect resolves false when the runtime aborts during the discovery join`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P35
- `observer connect resolves false when the runtime aborts during the pre-join chain read`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P36, REQ-RUNTIME-3-VQXW59.T1.P61
- `a late sync success after the abort changes nothing`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P33
- `a late sync failure after the abort changes nothing`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P34
- `reports a failed participant read after an OPENED handshake to the runtime's top-level error handling, with no connection hook`: REQ-AUTH-5-BQG9AG.T2.P1, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P11
- `reports a throwing sync after an OPENED handshake to the runtime's top-level error handling, with no connection hook`: REQ-AUTH-5-BQG9AG.T2.P2, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P12
- `drops a participant read that fails during runtime teardown: no error, no connection hook`: REQ-AUTH-5-BQG9AG.T2.P3, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P13

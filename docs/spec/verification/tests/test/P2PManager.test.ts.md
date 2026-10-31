# P2PManager.test.ts

Test file: [test/P2PManager.test.ts](../../../../../test/P2PManager.test.ts)
Exercises: [P2PManager.ts](../../../implementation/source/src/P2PManager.ts.md)

## Overview

Register a real transport with a competing profile identity; getConnectedPeers includes the transport address and excludes the profile address.

The suite drives the real host-side manager through its custom-RPC control fixture. It covers the
ordered frame gates, UTF-8 byte boundaries, every implemented request settlement and race with
registry/timer cleanup, disconnect and disposal cleanup, original-transport retirement, bulk
penalties, broadcast, and peer-registry snapshots. The connection-set probe adds a Holepunch and a
WebRTC transport, re-adds the first, and closes it twice; it asserts the exact ordered
`onConnectionsChanged` sets with their transport types and that the repeated add and close emit nothing. The ingress probes authenticate fault senders
and prove that oversized, malformed-envelope, unknown-service, and unknown-endpoint traffic
blacklists them. A throwing local service only disconnects. The lifecycle probe also proves that a
fault on a retired authenticated transport blacklists the current address profile and closes both
transports.

The initial-sync genesis and abort cases keep the original participants authoring through the fresh
observer's spawn and the held-request window. This prevents a participant timeout from changing the
fork before the settlement behavior is exercised; protocol time values are unchanged.

The early targeted-cancel case parks the first opened-status read of a connect with opening permission
through the stub service, cancels during that read and then releases it; the cancel must return `true`,
the connect `false`, and the lobby must show no matching session and no joined topic.

The held participant-check cases park the observer's real chain participant reads through the stub
service while the initial deadline task runs. With the reads still held, they check that the observer is
neither aborted nor disposed, stays `OPENED` and sent no sync request. Then they release the reads as
participant, as "not a participant", as a rejection, one at a time with two held reads, or after both
checked transports were closed. A participant answer must give one sync request and `SYNCED`. Every other
end must close the host and settle connect `false`; a rejection must also give one error-level line per
rejected read and a detached error with the stub failure. The two-window case holds every participant's
spectate response and reads the initial sync's recorded settlement: result `false`, a request timeout of
two windows, and more than one and a half windows from start to settle. The still-syncing deadline case
gives the observer one participant whose own initial sync is held, so it answers that it is still
syncing; the observer's first answer is parked after it is recorded while the held deadline task runs:
no abort, `OPENED`. Releasing the answer must schedule one new two-window deadline; two later answers
schedule none, leave the participant connected with no strike, and the restarted deadline aborts the
observer with connect `false` and no state set. The genesis-settle case holds
the deadline task, checks that the settle cancelled it, then runs the held task and expects no abort.

The after-cut probe disposes the manager, then builds a Holepunch transport and an open WebRTC
channel through the real constructors over recording sockets and feeds each a dispatch frame; both
must be closed with their sockets, with no frame written, no dispatch and no open connection.

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
- `original transport retirement keeps its pending request pending on the replacement, whose reply settles it`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P25, REQ-TJOIN-4-SDPZJW.T1.P3
- `reports no disconnection when the remote retires the original transport while the replacement stays live, and one when the last transport closes`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P13, REQ-UPG-2-WH7BC7.T1.P6
- `unrelated peer cannot settle pending request`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P3, REQ-RPC-2-SZDTTM.T1.P5, INTEGRATION-TEST-RPC-3-ZKFXGT.P13, REQ-TJOIN-4-SDPZJW.T1.P4
- `routes a response by peer address before retirement and ignores duplicates`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P5, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P11, REQ-RPC-2-SZDTTM.T1.P3, REQ-TJOIN-4-SDPZJW.T1.P1
- `deduplicates connections, broadcasts once, blacklists peers, and reports known addresses`: UNIT-TEST-P2P-MANAGER-2-HR5HCB.P1, UNIT-TEST-P2P-MANAGER-2-HR5HCB.P2, UNIT-TEST-P2P-MANAGER-3-0FEPCH.P1, UNIT-TEST-P2P-MANAGER-3-0FEPCH.P2, UNIT-TEST-P2P-MANAGER-3-0FEPCH.P3
- `blacklists and disconnects every peer in a bulk penalty`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P26
- `uses profile fallback, deduplicates addresses, and omits unknown peers`: UNIT-TEST-P2P-MANAGER-3-0FEPCH.P4
- `reports each change of the connection set with its transport types, leaves out a peerless transport, and reports nothing for a repeated add or close`: REQ-SDK-ARCH-7-H64K87.T1.P1, REQ-SDK-ARCH-7-H64K87.T1.P2, REQ-SDK-ARCH-7-H64K87.T1.P3, REQ-SDK-ARCH-7-H64K87.T1.P4, REQ-SDK-ARCH-7-H64K87.T1.P6, REQ-SDK-ARCH-7-H64K87.T1.P8, UNIT-TEST-P2PMANAGER-32-RX8SQP.P2, UNIT-TEST-P2PMANAGER-32-RX8SQP.P3
- `ignores a completed handshake with no registered transport`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P10, REQ-AUTH-5-BQG9AG.T1.P10
- `does not promote a transport that closed before handshake dispatch`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P7, REQ-AUTH-5-BQG9AG.T1.P7
- `does not promote a late handshake after manager disposal`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P8, REQ-AUTH-5-BQG9AG.T1.P8
- `closes a Holepunch connection and a WebRTC channel arriving after the network cut, which send and dispatch nothing (worker)`: UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA.P3
- `closes a Holepunch connection and a WebRTC channel arriving after the network cut, which send and dispatch nothing (inline)`: UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA.P3
- `retires a replaced handshake transport and keeps one live connection`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P9, REQ-AUTH-5-BQG9AG.T1.P9
- `emits profile loss only after the last live transport closes`: UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P7, REQ-LOBBY-8-31BE0F.T1.P1, REQ-LOBBY-8-31BE0F.T1.P2, REQ-LOBBY-8-31BE0F.T1.P4
- `initial handshake starts one channel-load sync and reaches SYNCED`: none
- `normal post-open discovery reaches channel participants`: none
- `provider open event switches targeted matching to raw channel discovery`: none
- `unopened target without autoOpen leaves raw and matching discovery untouched`: INV-TJOIN-1-R3K75D.T1.P1
- `targeted matching keeps the selected channel without entering DISCOVERING`: INV-TJOIN-1-R3K75D.T1.P4
- `targeted matching probe settles after the derived topic is joined`: none
- `a cancel during the target's opened-status read ends the connect before matching starts`: UNIT-TEST-LOCAL-P2P-SIGNER-3-3XWPRV.P1, REQ-TJOIN-1-5VGR1F.T1.P8
- `unsigned targeted failure retains the target and blacklists neither peer`: UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P1, REQ-TJOIN-5-Q795M7.T1.P11
- `explicit same-ID retry creates a fresh matcher and negotiation attempt`: UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P2, REQ-TJOIN-5-Q795M7.T1.P2
- `fatal initial sync closes its root and rejects later same-channel client calls`: UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P3, REQ-TJOIN-5-Q795M7.T1.P4
- `observer initial sync request to a participant that never answers times out after two agreement windows`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P42, REQ-TJOIN-3-DCZKS6.T1.P18, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P114
- `observer holds the initial deadline while a still-syncing answer is in flight, restarts it on that participant's first still-syncing answer only, and aborts at the restarted deadline`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P47, UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P48
- `observer connect resolves false when no participant handshake completes within the initial window`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P28, REQ-TJOIN-3-DCZKS6.T1.P6
- `observer holds the initial deadline while a completed handshake's participant check runs and syncs once the check answers participant`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P37, REQ-TJOIN-3-DCZKS6.T1.P13
- `observer aborts once a held participant check ends without a sync after the initial deadline elapsed`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P38, REQ-TJOIN-3-DCZKS6.T1.P14
- `observer aborts and keeps the error log once a held participant check rejects after the initial deadline elapsed`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P39, REQ-TJOIN-3-DCZKS6.T1.P15
- `observer holds the initial deadline until the last of two participant checks ends without a sync`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P40, REQ-TJOIN-3-DCZKS6.T1.P16
- `observer aborts once its held participant checks end on closed transports after the initial deadline elapsed`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P41, REQ-TJOIN-3-DCZKS6.T1.P17
- `observer connect resolves true when chain genesis lands before any participant handshake`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P29, REQ-TJOIN-3-DCZKS6.T1.P7
- `observer cancels the initial deadline when chain genesis settles the wait and stays synced if it still runs`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P32
- `observer ignores a stale false sync result once chain genesis already synced it`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P30, REQ-TJOIN-3-DCZKS6.T1.P8
- `observer connect resolves false when the runtime aborts while the initial wait is armed`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P31
- `observer connect resolves false when the runtime aborts during the discovery join`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P35
- `observer connect resolves false when the runtime aborts during the pre-join chain read`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P36, REQ-RUNTIME-3-VQXW59.T1.P61
- `a late sync success after the abort changes nothing`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P33
- `a late sync failure after the abort changes nothing`: UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P34
- `reports a failed participant read after an OPENED handshake to the runtime's top-level error handling, with no connection hook`: REQ-AUTH-5-BQG9AG.T2.P1, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P11
- `reports a throwing sync after an OPENED handshake to the runtime's top-level error handling, with no connection hook`: REQ-AUTH-5-BQG9AG.T2.P2, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P12
- `drops a participant read that fails during runtime teardown: no error, no connection hook`: REQ-AUTH-5-BQG9AG.T2.P3, UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P13

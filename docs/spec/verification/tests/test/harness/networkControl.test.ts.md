# test/harness/networkControl.test.ts — Test Report

> **Test file:** [test/harness/networkControl.test.ts](../../../../../../test/harness/networkControl.test.ts)  
> **Status:** Authored — engineer verification pending.

## Overview

Two real peer addresses in both index orders assign the lower address to advertiser and the other to selector.

The tests prove that intentional harness isolation blacklists a peer in both directions so discovery cannot
reconnect it, while explicit reconnection leaves the selected topic, clears that harness policy, and rejoins
to restart discovery after isolation stopped its retry loop. Initial connection uses
a separate path and does not silently clear policy it did not establish. They also prove that
`connectToChannel` acknowledges dispatch immediately, forwards serializable options, and reports both a
fulfilled `false` and a signer rejection through the detached-error owner. The RPC acknowledgement and
action-level `Promise<void>` are not the public signer Boolean.

This evidence supports [`REQ-TJOIN-1-5VGR1F`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                 | Covers                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`harness network control > intentional peer isolation blacklists both Holepunch directions`](../../../../../../test/harness/networkControl.test.ts#L29) (line 29)               | [`UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P7`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-holepunch-ban-1-5fb896.p7)                                                                                            |
| [`harness network control > explicit peer reconnection clears the harness blacklist`](../../../../../../test/harness/networkControl.test.ts#L57) (line 57)                       | [`UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P11`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-holepunch-ban-1-5fb896.p11)                                                                                          |
| [`harness network control > connectToChannel control returns while the signer promise is unsettled`](../../../../../../test/harness/networkControl.test.ts#L80) (line 80)        | [`REQ-TJOIN-1-5VGR1F.T1.P1`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f.t1.p1)                                                                                                       |
| [`harness network control > detached unmatched matchmaking timeout false becomes the first detached error`](../../../../../../test/harness/networkControl.test.ts#L96) (line 96) | [`REQ-TJOIN-2-MFWADG.T1.P2`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg.t1.p2)                                                                                                       |
| [`harness network control > connectToChannel control surfaces a signer rejection as a detached error`](../../../../../../test/harness/networkControl.test.ts#L113) (line 113)    | [`REQ-TJOIN-5-Q795M7.T1.P4`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p4)                                                                                                       |
| [`harness network control > connectToChannel control forwards options before detached dispatch`](../../../../../../test/harness/networkControl.test.ts#L128) (line 128)          | [`REQ-TJOIN-1-5VGR1F.T1.P4`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f.t1.p4)                                                                                                       |
| [`harness network control > accepted match remains collected past matchmaking timeout`](../../../../../../test/harness/networkControl.test.ts#L150) (line 150)                   | —                                                                                                                                                                                                                                  |
| [`harness network control > full-flow connect awaits detached success before test completion`](../../../../../../test/harness/networkControl.test.ts#L191) (line 191)            | —                                                                                                                                                                                                                                  |
| [`harness network control > expected connect failure does not hide an unrelated detached error`](../../../../../../test/harness/networkControl.test.ts#L214) (line 214)          | —                                                                                                                                                                                                                                  |
| [`harness network control > orders lobby roles by the two real peer addresses in either peer ordering`](../../../../../../test/harness/networkControl.test.ts#L9) (line 9)       | [`UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-HELPERS-32-FMP9H2.P1`](../../../../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-channel-negotiation-helpers-32-fmp9h2.p1) |

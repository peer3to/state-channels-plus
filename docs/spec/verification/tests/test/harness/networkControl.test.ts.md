# test/harness/networkControl.test.ts — Test Report

> **Test file:** [test/harness/networkControl.test.ts](../../../../../../test/harness/networkControl.test.ts)  
> **Status:** Authored — engineer verification pending.

## Overview

The tests prove that intentional harness isolation blacklists a peer in both directions so discovery cannot
reconnect it, while explicit reconnection leaves the selected topic, clears that harness policy, and rejoins
to restart discovery after isolation stopped its retry loop. Initial connection uses
a separate path and does not silently clear policy it did not establish. They also prove that
`connectToChannel` acknowledges dispatch immediately, forwards serializable options, and reports both a
fulfilled `false` and a signer rejection through the detached-error owner. The RPC acknowledgement and
action-level `Promise<void>` are not the public signer Boolean.

This evidence supports [`REQ-TJOIN-1-5VGR1F`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                 | Covers                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`harness network control > intentional peer isolation blacklists both Holepunch directions`](../../../../../../test/harness/networkControl.test.ts#L10) (line 10)               | [`UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P7`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-holepunch-ban-1-5fb896.p7)   |
| [`harness network control > explicit peer reconnection clears the harness blacklist`](../../../../../../test/harness/networkControl.test.ts#L38) (line 38)                       | [`UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P11`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-holepunch-ban-1-5fb896.p11) |
| [`harness network control > connectToChannel control returns while the signer promise is unsettled`](../../../../../../test/harness/networkControl.test.ts#L61) (line 61)        | [`REQ-TJOIN-1-5VGR1F.T1.P1`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f.t1.p1)              |
| [`harness network control > detached unmatched matchmaking timeout false becomes the first detached error`](../../../../../../test/harness/networkControl.test.ts#L77) (line 77) | [`REQ-TJOIN-2-MFWADG.T1.P2`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg.t1.p2)              |
| [`harness network control > connectToChannel control surfaces a signer rejection as a detached error`](../../../../../../test/harness/networkControl.test.ts#L94) (line 94)      | [`REQ-TJOIN-5-Q795M7.T1.P4`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p4)              |
| [`harness network control > connectToChannel control forwards options before detached dispatch`](../../../../../../test/harness/networkControl.test.ts#L109) (line 109)          | [`REQ-TJOIN-1-5VGR1F.T1.P4`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f.t1.p4)              |
| [`harness network control > accepted match remains collected past matchmaking timeout`](../../../../../../test/harness/networkControl.test.ts#L131) (line 131)                   | —                                                                                                                                         |
| [`harness network control > full-flow connect awaits detached success before test completion`](../../../../../../test/harness/networkControl.test.ts#L172) (line 172)            | —                                                                                                                                         |
| [`harness network control > expected connect failure does not hide an unrelated detached error`](../../../../../../test/harness/networkControl.test.ts#L195) (line 195)          | —                                                                                                                                         |

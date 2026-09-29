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

These are harness self-tests. They assert the control acknowledgement and the detached-error message, not
the public connect result, so they assign no targeted-join permutation; the isolation case proves harness
blacklisting, not that an explicit blacklist is never lifted. The related requirement is [`REQ-TJOIN-1-5VGR1F` (Independent public options)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                 | Covers                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`harness network control > intentional peer isolation blacklists both Holepunch directions`](../../../../../../test/harness/networkControl.test.ts#L29) (line 29)               | —                                                                                                                                                                                                                                          |
| [`harness network control > explicit peer reconnection clears the harness blacklist`](../../../../../../test/harness/networkControl.test.ts#L57) (line 57)                       | [`UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P11`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-holepunch-ban-1-5fb896.p11)                                                                                                  |
| [`harness network control > connectToChannel control returns while the signer promise is unsettled`](../../../../../../test/harness/networkControl.test.ts#L80) (line 80)        | —                                                                                                                                                                                                                                          |
| [`harness network control > detached unmatched matchmaking timeout false becomes the first detached error`](../../../../../../test/harness/networkControl.test.ts#L96) (line 96) | —                                                                                                                                                                                                                                          |
| [`harness network control > connectToChannel control surfaces a signer rejection as a detached error`](../../../../../../test/harness/networkControl.test.ts#L113) (line 113)    | —                                                                                                                                                                                                                                          |
| [`harness network control > connectToChannel control forwards options before detached dispatch`](../../../../../../test/harness/networkControl.test.ts#L128) (line 128)          | —                                                                                                                                                                                                                                          |
| [`harness network control > accepted match remains collected past matchmaking timeout`](../../../../../../test/harness/networkControl.test.ts#L150) (line 150)                   | —                                                                                                                                                                                                                                          |
| [`harness network control > full-flow connect awaits detached success before test completion`](../../../../../../test/harness/networkControl.test.ts#L191) (line 191)            | —                                                                                                                                                                                                                                          |
| [`harness network control > expected connect failure does not hide an unrelated detached error`](../../../../../../test/harness/networkControl.test.ts#L214) (line 214)          | —                                                                                                                                                                                                                                          |
| [`harness network control > orders lobby roles by the two real peer addresses in either peer ordering`](../../../../../../test/harness/networkControl.test.ts#L9) (line 9)       | [`UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-HELPERS-32-FMP9H2.P1`](../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts.md#unit-test-open-channel-negotiation-helpers-32-fmp9h2.p1) |

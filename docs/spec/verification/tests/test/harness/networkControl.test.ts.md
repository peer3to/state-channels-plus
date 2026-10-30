# networkControl.test.ts

Test file: [test/harness/networkControl.test.ts](../../../../../../test/harness/networkControl.test.ts)

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
blacklisting, not that an explicit blacklist is never lifted. The related requirement is `REQ-TJOIN-1-5VGR1F`.

## Tests

- `intentional peer isolation blacklists both Holepunch directions`: none
- `explicit peer reconnection clears the harness blacklist`: UNIT-TEST-HOLEPUNCH-BAN-1-5FB896.P11
- `connectToChannel control returns while the signer promise is unsettled`: none
- `detached unmatched matchmaking timeout false becomes the first detached error`: none
- `connectToChannel control surfaces a signer rejection as a detached error`: none
- `connectToChannel control forwards options before detached dispatch`: none
- `accepted match remains collected past matchmaking timeout`: none
- `full-flow connect awaits detached success before test completion`: none
- `expected connect failure does not hide an unrelated detached error`: none
- `orders lobby roles by the two real peer addresses in either peer ordering`: UNIT-TEST-OPEN-CHANNEL-NEGOTIATION-HELPERS-32-FMP9H2.P1

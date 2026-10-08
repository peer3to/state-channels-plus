# HostNonceManager.test.ts

Test file: [test/evm/HostNonceManager.test.ts](../../../../../../test/evm/HostNonceManager.test.ts)
Exercises: [HostNonceManager.ts](../../../../implementation/source/src/evm/signer/HostNonceManager.ts.md)

## Overview

The suite drives `HostNonceManager` against a live Hardhat node with fresh funded wallets,
calling `sendTransaction`/`connect` directly and controlling mining via `evm_setAutomine`. The
oracles are the final on-chain nonce sequence, rejection messages, and a stubbed `getNonce` call
count. The cases prove: a failed middle send's nonce is reused without colliding with concurrent
sends (the accepted transactions end up with a gap-free consecutive nonce run); `connect` to the
same provider returns the same manager and reconnecting elsewhere throws, so no second nonce
owner can exist; and after a transient nonce-query failure leaves the account state
indeterminate, recovery is lazy — the next send re-queries once, surfaces a further transient
failure as-is, and the following send reconciles to the true pending nonce.

Eleven further cases drive the gas usage the manager records. On the shared node, transactions
carrying a selector the SDK contract surface declares and one it does not are sent through the
manager and mined, and the settled snapshot must hold one row per selector against the real
callee, with the named row counting both of its sends and a total that is twice each bound. Three
more shared-node cases need no mining control: a send worth more than the wallet holds, with an
explicit limit so nothing is estimated, must be refused by the node and reject with nothing
recorded; a deployment of init code whose runtime is the single byte `STOP` must mine — its code
is read back — and leave the table empty; and a recorder disposed before a send must record
nothing for it while the send itself still mines.

The remaining seven each own a hardhat node for their whole lifetime, spawned on a free port and
killed in `finally`, because they need mining turned off or the provider destroyed. A call to a
deployed always-reverting contract, broadcast with an explicit gas limit so ethers never estimates
and with automine off so the node cannot throw the revert back at broadcast, must land in the
row's reverted count and reverted total — matching the real receipt's `gasUsed` — while the
success count, success total and both bounds stay empty. A transaction replaced at the same nonce
before it mined must be absent from the table. An observation whose provider is destroyed while its
receipt wait is subscribed must settle, once the recorder is disposed, before the event loop's next
turn, and leave no row. An observation started inside an open `settle()` window, kept unmineable
by a nonce gap, must not hold that `settle()` back; receipt waits have no bound of their own, so a
settle that re-read the set would fail on the test timeout. With automine off, a read bounded to
500 ms must answer no earlier than its bound and without the pending transaction, and once blocks
are mined a later read must hold that transaction with its real receipt gas. In the recovery
case, the wallet broadcasts the exact bytes the manager is about to sign for its next nonce; the
node refuses the manager's broadcast of the same bytes — a second broadcast of them is shown to be
refused — and the manager must answer with the transaction the node held, which is recorded with
its real receipt gas once it mines. A last case recovers such a transaction the same way, then the wallet sends a
replacement at the same nonce and twice the price, and blocks are mined in the background: the
caller's own `wait()` must reject as `TRANSACTION_REPLACED` naming the replacement, and an
unbounded settled read must resolve with only the first send's row — neither the replaced
transaction nor its replacement is counted under its selector. Without replacement detection on
the recovered response neither wait ever ends, and the test timeout fails the case. Signing
confinement and port-crossing rules belong to the p2p runtime suites, not here.

Two more cases own a node for the same reason. The first records every JSON-RPC request its
provider sends, through the provider's `debug` events. It waits past the provider's 250 ms request
cache so that no read from setup is reused, then sends one call through the manager with legacy
fields, a fixed price and an explicit limit, so nothing before the broadcast reads the block number.
Up to and including the request that carries `eth_sendRawTransaction`, there must be exactly one
`eth_blockNumber`, and it must travel in that same request: the manager's start-block read and the
broadcast's own read are one request, and the send waits no extra round trip. A start-block read
awaited before the broadcast would go in an earlier request and fail the case. The second puts a real HTTP proxy between the manager's provider and the node. The
proxy answers the broadcast's `eth_blockNumber` with a JSON-RPC error and forwards the raw
transaction sent with it, so the node accepts a transaction whose broadcast rejects. The send must
still resolve with the transaction the node holds, sent by the manager's wallet; after the 250 ms
cache of the failed read, the caller's `wait()` must see it mined, and the next send must use the
following nonce. A recovery that only reused the failed shared read, or read the start block again
through a new `getBlockNumber()` answered from the cache, rejects with "could not be reconciled".

## Tests

- `reuses a failed middle nonce without colliding with concurrent sends`: none
- `sends without a caller limit using its estimate plus headroom and keeps an explicit limit`: REQ-SDK-ARCH-5-AAM7YK.T1.P1, REQ-SDK-ARCH-5-AAM7YK.T1.P2, REQ-SDK-ARCH-5-AAM7YK.T1.P3
- `records the gas of the transactions it broadcast, named by selector`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P1, UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P2, UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P3, REQ-SDK-ARCH-6-8DE4ER.T1.P2, REQ-SDK-ARCH-6-8DE4ER.T1.P3, REQ-SDK-ARCH-6-8DE4ER.T1.P6
- `records a reverted call under the reverted fields only`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P5, REQ-SDK-ARCH-6-8DE4ER.T1.P4
- `leaves a replaced transaction out of the table`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P4
- `settles an observation whose provider closed under its receipt wait once disposed`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P6
- `settles the observations started before the call, not the later ones`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P7
- `leaves a pending receipt out of a bounded read and counts it once it mines`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P8, REQ-SDK-ARCH-6-8DE4ER.T1.P9
- `records a transaction the node already held when its broadcast failed`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P9
- `settles and leaves out a recovered transaction once its replacement mines`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P13
- `sends its replacement-scan start-block read in the same request as the broadcast`: none
- `recovers a transaction the node accepted when the broadcast's block-number read failed`: none
- `records nothing for a broadcast the node rejected`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P10, REQ-SDK-ARCH-6-8DE4ER.T1.P10
- `leaves a deployment out of the table`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P11
- `records nothing it observes after its recorder was disposed`: UNIT-TEST-GAS-USAGE-RECORDER-1-F2H4X8.P12
- `cannot create another nonce owner by reconnecting`: none
- `recovers an indeterminate nonce lazily on the next send`: none

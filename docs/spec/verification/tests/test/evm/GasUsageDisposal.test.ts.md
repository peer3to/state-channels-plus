# GasUsageDisposal.test.ts

Test file: [test/evm/GasUsageDisposal.test.ts](../../../../../../test/evm/GasUsageDisposal.test.ts)
Exercises: [P2pRuntimeHostRoot.ts](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)

## Overview

One real SDK participant is started in a worker against the live chain, with a local log receiver
as its upload endpoint. The case first asserts that nothing has been reported yet, then sends one
transaction through the participant's own public chain signer and awaits only its broadcast — the
receipt is deliberately still outstanding, which is the state a peer's last sends are in when it
leaves — and then disposes the participant. The oracles are the `"gas usage"` entries decoded from
the receiver's uploads, which the root's log flush sends before the worker's port closes: exactly
one record, a `functionCount` of one, and a row keyed on the real callee and the real selector,
named `postBlockCalldata` from the SDK contract surface, with one successful transaction and a
positive success total. A report that fired twice, fired with an empty table because the outstanding
receipt was not waited for, never fired, or was not flushed before the port closed fails this case.
The bound that keeps the disposal settle from hanging on an unreachable chain is a configuration
value, not an oracle here.

## Tests

- `reports the gas usage aggregate once when the participant is disposed`: REQ-SDK-ARCH-6-8DE4ER.T1.P8, REQ-RUNTIME-3-VQXW59.T1.P95

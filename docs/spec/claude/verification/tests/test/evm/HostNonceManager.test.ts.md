# test/evm/HostNonceManager.test.ts — Test Report

> **Test file:** [test/evm/HostNonceManager.test.ts](../../../../../../../test/evm/HostNonceManager.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [HostNonceManager.ts](../../../../implementation/source/src/evm/signer/HostNonceManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `HostNonceManager` against a live Hardhat node with fresh funded wallets,
calling `sendTransaction`/`connect` directly and controlling mining via `evm_setAutomine`. The
oracles are the final on-chain nonce sequence, rejection messages, and a stubbed `getNonce` call
count. The cases prove: a failed middle send's nonce is reused without colliding with concurrent
sends (the accepted transactions end up with a gap-free consecutive nonce run); `connect` to the
same provider returns the same manager and reconnecting elsewhere throws, so no second nonce
owner can exist; and after a transient nonce-query failure leaves the account state
indeterminate, recovery is lazy — the next send re-queries once, surfaces a further transient
failure as-is, and the following send reconciles to the true pending nonce. Signing confinement
and port-crossing rules belong to the p2p runtime suites, not here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                  | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`HostNonceManager > reuses a failed middle nonce without colliding with concurrent sends`](../../../../../../../test/evm/HostNonceManager.test.ts#L10) (line 10) | —      |
| [`HostNonceManager > cannot create another nonce owner by reconnecting`](../../../../../../../test/evm/HostNonceManager.test.ts#L72) (line 72)                    | —      |
| [`HostNonceManager > recovers an indeterminate nonce lazily on the next send`](../../../../../../../test/evm/HostNonceManager.test.ts#L82) (line 82)              | —      |

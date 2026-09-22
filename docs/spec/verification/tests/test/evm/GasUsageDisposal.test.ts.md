# test/evm/GasUsageDisposal.test.ts — Test Report

> **Test file:** [test/evm/GasUsageDisposal.test.ts](../../../../../../test/evm/GasUsageDisposal.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [P2pRuntimeHostRoot.ts](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One real SDK participant is started inline against the live chain, so the runtime host realm and
its log store stay in this process after the host connection is gone. The case first asserts that
nothing has been reported yet, then sends one transaction through the participant's own public
chain signer and awaits only its broadcast — the receipt is deliberately still outstanding, which
is the state a peer's last sends are in when it leaves — and then disposes the participant. The
oracles are the host realm's own log entries: exactly one `"gas usage"` record, a `functionCount`
of one, and a row keyed on the real callee and the real selector, named `postBlockCalldata` from
the SDK contract surface, with one successful transaction and a positive success total. A report
that fired twice, fired with an empty table because the outstanding receipt was not waited for, or
never fired at all fails this case. The bound that keeps the disposal settle from hanging on an
unreachable chain is a configuration value, not an oracle here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                              | Covers                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`GasUsageDisposal > reports the gas usage aggregate once when the participant is disposed`](../../../../../../test/evm/GasUsageDisposal.test.ts#L9) (line 9) | [`REQ-SDK-ARCH-5-NSJYQT.T1.P8`](../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt.t1.p8) |

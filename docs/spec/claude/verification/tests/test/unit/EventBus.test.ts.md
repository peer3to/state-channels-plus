# test/unit/EventBus.test.ts — Test Report

> **Test file:** [test/unit/EventBus.test.ts](../../../../../../../test/unit/EventBus.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventBus.ts](../../../../implementation/source/src/events/EventBus.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite constructs `EventBus` instances directly and drives `on`/`onKind`/`emit`/`clear`, the
bridge tap, and `attachContractEvents` against fixture ethers contracts
(`createEventContract` with a small ABI), with no channel or harness session. It pins the
dispatch contract: named events are isolated per kind, kind-wide listeners run after named ones,
and the bridge tap runs last with only its error propagating after every local sink ran. Lifecycle
tests cover unsubscribe, `clear()` removing consumer subscriptions (named and kind-wide) while
keeping runtime-owned wiring (attached mirrors and the port bridge), stale unsubscribers not
touching re-registered listeners, throwing listeners being isolated and reported through the error
callback, and mutation during dispatch iterating a snapshot. The contract-attachment tests assert
re-emission onto attached ethers instances, independent detach, skipping events outside the
attached ABI, and rejected or ambiguous mirror emits routing to the attach callback or the bus
error reporter — never a detached unhandled rejection, which the tests watch for explicitly.
Oracles are recorded delivery orders and counts, reported error strings, and the absence of
`unhandledRejection` events. The component's implementation report defines no test obligations and
no specification permutation targets this utility, so no test IDs are assignable to this suite.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                           | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`EventBus (component) > delivers named events per kind and keeps the same name isolated across kinds`](../../../../../../../test/unit/EventBus.test.ts#L14) (line 14)                                                     | —      |
| [`EventBus (component) > clear() removes consumer subscriptions but keeps runtime wiring (bridge tap and attached mirrors)`](../../../../../../../test/unit/EventBus.test.ts#L31) (line 31)                                | —      |
| [`EventBus (component) > routes a failed mirror emit to the bus error reporter when no callback is passed (the production attachment shape)`](../../../../../../../test/unit/EventBus.test.ts#L67) (line 67)               | —      |
| [`EventBus (component) > supports several listeners, unsubscribe, and clear`](../../../../../../../test/unit/EventBus.test.ts#L98) (line 98)                                                                               | —      |
| [`EventBus (component) > keeps a re-registered listener when an unsubscribe from before clear() runs late`](../../../../../../../test/unit/EventBus.test.ts#L123) (line 123)                                               | —      |
| [`EventBus (component) > isolates a throwing listener and reports it through the error callback`](../../../../../../../test/unit/EventBus.test.ts#L152) (line 152)                                                         | —      |
| [`EventBus (component) > tolerates listeners added or removed during an emit`](../../../../../../../test/unit/EventBus.test.ts#L173) (line 173)                                                                            | —      |
| [`EventBus (component) > runs kind-wide listeners after named ones and the bridge tap last, propagating only the bridge error after all local sinks ran`](../../../../../../../test/unit/EventBus.test.ts#L198) (line 198) | —      |
| [`EventBus (component) > re-emits bus contract events onto an attached ethers instance and stops after detach`](../../../../../../../test/unit/EventBus.test.ts#L224) (line 224)                                           | —      |
| [`EventBus (component) > skips events outside the attached contract's ABI without a rejection`](../../../../../../../test/unit/EventBus.test.ts#L256) (line 256)                                                           | —      |
| [`EventBus (component) > routes a rejected contract emit to the attach error callback instead of a detached rejection`](../../../../../../../test/unit/EventBus.test.ts#L287) (line 287)                                   | —      |
| [`EventBus (component) > still delivers to a contract attached after the bridge tap even when the bridge fails`](../../../../../../../test/unit/EventBus.test.ts#L319) (line 319)                                          | —      |

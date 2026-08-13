# test/evm/CustomRpcTypes.test.ts — Test Report

> **Test file:** [test/evm/CustomRpcTypes.test.ts](../../../../../../../test/evm/CustomRpcTypes.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A compile-time typing suite: it declares a full custom RPC stack (`PingRpc` extending
`MainRpcService`, two `ARpcService` subclasses with their `ARpcMethods` classes) and a
never-executed `assertCustomRpcTypes` function whose body is the oracle. The type checker must
accept `localRpc`/`remoteRpc` access to the declared services and their method signatures, and —
via `@ts-expect-error` — must reject a wrong argument type on a remote method and access to an
undeclared service. The single runtime test only anchors the file in the suite; nothing executes
against a transport. Because the assertions live in the type system, no runtime test-plan
permutation can be assigned to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                              | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`CustomRpc typing > allows custom RPC classes to extend MainRpcService`](../../../../../../../test/evm/CustomRpcTypes.test.ts#L95) (line 95) | —      |

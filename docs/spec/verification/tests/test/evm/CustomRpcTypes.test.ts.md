# test/evm/CustomRpcTypes.test.ts — Test Report

> **Test file:** [test/evm/CustomRpcTypes.test.ts](../../../../../../test/evm/CustomRpcTypes.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A compile-time typing suite: its shared RpcProxyTypesFixture declares a full custom RPC stack (`PingRpc` extending
`MainRpcService`, two `ANetworkRpcService` subclasses with their `ANetworkRpcMethods` classes) and a
never-executed `assertCustomRpcTypes` function whose body is the oracle. The type checker must
accept `localRpc`/`remoteRpc` access to the declared services and their method signatures, expose
only fire-and-forget verbs for `void` methods, and expose only `request` for value methods. Via
`@ts-expect-error`, it must reject the opposite delivery face, a wrong argument type, and access to
an undeclared service. The single runtime declaration anchors this compilation oracle; nothing
executes against a transport.

## Tests and covered test IDs

| Test                                                                                                                                     | Covers                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`CustomRpc typing > allows custom RPC classes to extend MainRpcService`](../../../../../../test/evm/CustomRpcTypes.test.ts#L7) (line 7) | [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P16`](../../../../implementation/source/src/rpc/network/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p16) |

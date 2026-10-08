# CrossModuleValues.test.ts

Test file: [test/utils/CrossModuleValues.test.ts](../../../../../../test/utils/CrossModuleValues.test.ts)
Exercises: [ObjectChecks.ts](../../../../implementation/source/src/utils/ObjectChecks.ts.md), [RemoteRpcProxy.ts](../../../../implementation/source/src/rpc/network/RemoteRpcProxy.ts.md), [ATransport.ts](../../../../implementation/source/src/transport/ATransport.ts.md), [EthersResultProxy.ts](../../../../implementation/source/src/utils/EthersResultProxy.ts.md), [Codec.ts](../../../../implementation/source/src/utils/Codec.ts.md)

## Overview

The suite constructs compatible RPC-service, transport, and ethers-Result values without
inheriting from the SDK or ethers constructors used by the code under test. It proves that public
runtime contracts survive separate production module graphs while incomplete services,
primitive transport values, wrong transport property types, missing/non-function transport
methods, and ordinary arrays remain rejected. The RPC acceptance case also reaches
`RemoteRpcProxy`; its cases cover stable and service-name-separated caching, incomplete and
non-service rejection, symbol inspection, and non-thenable Promise assimilation. The Result case
checks the converted named object rather than only the predicate. The proxy-wrapped Result case
proves structural recognition, single conversion through the contract proxy, and stable
already-normalized output.

## Tests

- `recognizes a fresh unauthenticated network transport from a separate module graph`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P12
- `recognizes actual runtime services without a peer manager`: UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P5
- `accepts an RPC service with the public service shape`: REQ-RPC-1-FF89Z0.T1.P7, REQ-RUNTIME-4-B0N70Y.T1.P5, INTEGRATION-TEST-RPC-5-ACP2QT.P1, UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P1, UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P4
- `rejects an object that is missing part of the RPC service shape`: UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P2, UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P5
- `passes symbol property access through to the local RPC root`: UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P3
- `rejects ordinary and missing string properties`: UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P4
- `remains non-thenable during Promise assimilation`: UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P5
- `keeps separate cached proxies for separate service names`: UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P6
- `accepts a transport with the public transport shape`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P5
- `rejects an object that is missing part of the transport shape`: UNIT-TEST-ATRANSPORT-1-7DGX9R.P6
- `accepts native and cross-module ethers Result values`: UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P1, UNIT-TEST-CODEC-1-HFAA3B.P24, UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P6
- `rejects arrays that do not expose the ethers Result API`: UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P2, UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P7
- `accepts proxy-wrapped Result values and does not convert normalized values twice`: UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P8, UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P3

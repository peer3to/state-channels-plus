# RpcProxyTypes.test.ts

Test file: [test/rpc/RpcProxyTypes.test.ts](../../../../../../test/rpc/RpcProxyTypes.test.ts)

## Overview

Compile-time checks independently reject concrete roots missing startup or disposal.

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests

- `reads a mutable peer service context when the captured method is called`: UNIT-TEST-RPC-PROXY-1-R74W81.P1
- `preserves bound arguments results void acknowledgement and explicit sends`: UNIT-TEST-RPC-PROXY-1-R74W81.P2
- `keeps runtime proxy roots non-thenable`: UNIT-TEST-RPC-PROXY-1-R74W81.P3
- `RpcProxyTypes > rejects unrelated roots and cross-category router transport and service types`: UNIT-TEST-RUNTIME-SERVICE-1-WH4SSY.P3, UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P6

The bound-type fixture also checks concrete remote handles, assignment to the common-root handle type, and rejection of domain services absent from that type.

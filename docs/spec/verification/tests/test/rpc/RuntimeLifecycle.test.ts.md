# RuntimeLifecycle tests

Test file: [RuntimeLifecycle.test.ts](../../../../../../test/rpc/RuntimeLifecycle.test.ts)
Exercises: [RuntimeLifecycleService](../../../../implementation/source/src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts.md)

## Overview

Uses actual SDK roots and channels to check retained readiness, connection-loss isolation, shutdown preparation and child-before-local disposal, failure cleanup, held quiesce replies and parent-only cleanup requests. Two inline cases collect held detached work on a real host root: failing it after the root disposed leaves the drain without a rejection, failing it before keeps the rejection in the drain. Fixtures record original domain operations and control actual frames; shared RPC performs invocation and settlement. The worker-SDK disposal case holds a real worker executor call that is released only in `finally`, after the assertions: disposal of the worker SDK completes through the executor's bounded admission drain, the SDK worker exits, the client root records no host error, and a sibling runtime still answers a probe call. It does not measure the drain duration or read the held call's rejection.

## Tests

- `remembers a child readiness signal received before awaiting`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P1, REQ-RUNTIME-3-VQXW59.T1.P18
- `resolves waiting callers once when the child signals ready`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P2, REQ-RUNTIME-3-VQXW59.T1.P19
- `rejects readiness on child close without affecting a ready sibling`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P3, REQ-RUNTIME-3-VQXW59.T1.P20
- `disposes children before local cleanup and shares repeated completion`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P4, REQ-RUNTIME-3-VQXW59.T1.P21
- `runs local cleanup after a child disposal post failure`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P5, REQ-RUNTIME-3-VQXW59.T1.P22
- `rejects cleanup requested upward without closing the parent`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P7, REQ-RUNTIME-3-VQXW59.T1.P24, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P10
- `RuntimeLifecycle > keeps children available while host shutdown preparation is held`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P8, REQ-RUNTIME-3-VQXW59.T1.P40
- `RuntimeLifecycle > cleans children and local resources after host preparation fails`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P9, REQ-RUNTIME-3-VQXW59.T1.P41
- `RuntimeLifecycle > disposes a standalone leaf once through the common root contract`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P1
- `RuntimeLifecycle > disposes a parent after its last child was already removed`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P2
- `RuntimeLifecycle > awaits all sibling roots before the parent closes`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P3
- `RuntimeLifecycle > recursively closes nested descendants before their ancestors`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P4
- `RuntimeLifecycle > rejects a second parent without changing the existing relationship`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P5
- `RuntimeLifecycle > installs one slow-request observer for normal root creation`: UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P1
- `RuntimeLifecycle > records pending root requests once and ignores failures after closure`: UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P2

The two root diagnostic cases retain service and method metadata without contract calldata fields, for both slow completion and pending requests on failure.

- `RuntimeLifecycle > disposes the worker custom RPC before its manager`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P13
- `RuntimeLifecycle > finishes worker manager cleanup after custom RPC disposal rejects`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P14
- `RuntimeLifecycle > automatically disposes root and application logger descendants and crash listeners`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P8, REQ-LOG-1-H2VQ8X.T2.P6
- `RuntimeLifecycle > collects new host errors after an earlier inline drain`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P11
- `RuntimeLifecycle > collects new host errors after an earlier worker drain`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P12
- `RuntimeLifecycle > shares concurrent child quiescence and drains again after completion`: REQ-RUNTIME-3-VQXW59.T1.P23, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P6
- `RuntimeLifecycle > finishes final cleanup when the parent closes during an admitted disposal`: REQ-RUNTIME-3-VQXW59.T1.P51, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P15
- `RuntimeLifecycle > exits the SDK worker after its parent is lost during disposal`: REQ-RUNTIME-3-VQXW59.T1.P52, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P16
- `RuntimeLifecycle > exits the SDK worker after its failed setup loses the error reply`: REQ-RUNTIME-3-VQXW59.T1.P53, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P17
- `RuntimeLifecycle > reports a ready SDK worker exit once with its original cause`: REQ-RUNTIME-3-VQXW59.T1.P54, UNIT-TEST-ROOT-ERROR-1-0N4XM4.P7, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P2
- `acknowledges worker SDK abort with a worker executor before exiting while the parent is busy`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P18, REQ-RUNTIME-3-VQXW59.T1.P57
- `reports executor worker exit through a worker SDK and rejects its pending call`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P19
- `disposes a worker SDK while its worker executor call is in flight`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P20, REQ-RUNTIME-3-VQXW59.T1.P78
- `acknowledges parent-requested worker SDK disposal before exiting while the parent is busy`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P21, REQ-RUNTIME-3-VQXW59.T1.P58
- `marks worker shutdown expected before parent port closure while client cleanup is held`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P3, REQ-RUNTIME-3-VQXW59.T1.P59
- `settles detached work that fails after root disposal as the disposal outcome`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P9, REQ-RUNTIME-3-VQXW59.T1.P62
- `keeps a detached failure before root disposal visible in the drain`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P10, REQ-RUNTIME-3-VQXW59.T1.P63

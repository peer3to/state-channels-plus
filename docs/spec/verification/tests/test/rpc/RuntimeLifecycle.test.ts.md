# RuntimeLifecycle tests

Test file: [RuntimeLifecycle.test.ts](../../../../../../test/rpc/RuntimeLifecycle.test.ts)
Exercises: [RuntimeLifecycleService](../../../../implementation/source/src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts.md)

## Overview

Uses actual SDK roots and channels to check retained readiness, connection-loss isolation, shutdown preparation and child-before-local disposal, failure cleanup, held quiesce replies and parent-only cleanup requests. Fixtures record original domain operations and control actual frames; shared RPC performs invocation and settlement. The worker-SDK disposal case holds a real worker executor call that is released only in `finally`, after the assertions: disposal of the worker SDK completes through the executor's bounded admission drain, the SDK worker exits, the client root records no host error, and a sibling runtime still answers a probe call. It does not measure the drain duration or read the held call's rejection. The worker-SDK abort case while the parent blocks its thread runs with log collection off (no upload endpoint): the worker exits within the parent's wait, and the client's real connection to the host carries no flush frame. Two worker-SDK teardown cases ([WorkerTeardownFixture](../../../../../../test/fixtures/node/WorkerTeardownFixture.ts)) set up the SDK from a scripted host entry ([TeardownHostEntry](../../../../../../test/fixtures/node/TeardownHostEntry.ts)) and dispose the `P2pInstance`: one closes a bound UDP socket just before the worker closes its handles, ahead of a second open socket, and asserts worker exit code 0, no drain warning in the client root's store and no host error; the other leaks a referenced timer on host disposal and asserts the drain-timeout exit code, a disposal no shorter than `ROOT_WORKER_DRAIN_TIMEOUT_MS`, one warning naming `P2pRuntimeHostRoot`, the drain bound and a `Timeout` resource, and no host error. Both cases start a local log receiver and turn crash-log upload on, because the client root's log store keeps entries only while upload is on; without it both warning checks would read an empty store.

The child-failure diagnostics case holds one request to the SDK host root and fails the child twice, each time on a new SDK setup: once with an ordinary `Error`, and once with a real `unreachable` trap that crossed the wire format (`serializeError`, then `deserializeError`), as a WebAssembly failure from a worker arrives. Each logs one `Worker failed with pending requests` line. Its `resources` holds this thread's counts both times; its `wasm` is absent for the ordinary error and equals the diagnostics serialized with the trap otherwise.

The report-during-disposal case raises a host error report while the client disposes the host: it
is logged at error on the client logger and reaches no `onHostError` listener; a report raised
before the disposal still reaches the listener.

The setup-disposal cases ([SetupDisposalFixture](../../../../../../test/fixtures/SetupDisposalFixture.ts)) dispose the client
root, observed as soon as it exists, while the public setup is held, in worker and inline
placement. The chain-read cases hold every `eth_call` of the host at a proxy in front of the node
and release the reads after the disposal began (for a worker, once the host's port closed): the
disposal settles within the reply drain bound of the release. The build cases load
[HeldBuildHostRoot](../../../../../../test/fixtures/hostRoot/HeldBuildHostRoot.ts) by manifest; it holds the result of the
local diamond deployment, the build's last executor call before the runtime is constructed. The
disposal settles within the reply drain bound while the build is held. A worker host lets the
build through at its own cut, an inline host only after the disposal settled; the host then
reports, when the setup request settles, that the runtime the build constructed is cut and
stopped. Every case asserts that the setup rejects, no host error is raised, the signer's chain
nonce is unchanged, and a fresh runtime for the same signer sets up and answers. With the build's
disposal check removed, both build cases fail with the runtime neither cut nor stopped.

## Tests

- `remembers a child readiness signal received before awaiting`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P1, REQ-RUNTIME-3-VQXW59.T1.P18
- `resolves waiting callers once when the child signals ready`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P2, REQ-RUNTIME-3-VQXW59.T1.P19
- `rejects readiness on child close without affecting a ready sibling`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P3, REQ-RUNTIME-3-VQXW59.T1.P20
- `disposes children before local cleanup and shares repeated completion`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P4, REQ-RUNTIME-3-VQXW59.T1.P21
- `runs local cleanup after a child disposal post failure`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P5, REQ-RUNTIME-3-VQXW59.T1.P22
- `rejects cleanup requested upward without closing the parent`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P7, REQ-RUNTIME-3-VQXW59.T1.P24, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P10
- `keeps children available while host shutdown preparation is held`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P8, REQ-RUNTIME-3-VQXW59.T1.P40
- `cleans children and local resources after host preparation fails`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P9, REQ-RUNTIME-3-VQXW59.T1.P41
- `disposes a standalone leaf once through the common root contract`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P1
- `disposes a parent after its last child was already removed`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P2
- `awaits all sibling roots before the parent closes`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P3
- `recursively closes nested descendants before their ancestors`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P4
- `rejects a second parent without changing the existing relationship`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P5
- `installs one slow-request observer for normal root creation`: UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P1
- `records pending root requests once and ignores failures after closure`: UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P2
- `logs the failed worker's WebAssembly diagnostics, or none for an ordinary error, and this thread's resources with pending requests`: UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P6

The two root diagnostic cases retain service and method metadata without contract calldata fields, for both slow completion and pending requests on failure.

- `automatically disposes root and application logger descendants and crash listeners`: UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P8, REQ-LOG-1-H2VQ8X.T2.P6
- `collects new host errors after an earlier inline drain`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P11
- `collects new host errors after an earlier worker drain`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P12
- `shares concurrent child quiescence and drains again after completion`: REQ-RUNTIME-3-VQXW59.T1.P23, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P6
- `finishes final cleanup when the parent closes during an admitted disposal`: REQ-RUNTIME-3-VQXW59.T1.P51, REQ-RUNTIME-3-VQXW59.T1.P84, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P15
- `exits the SDK worker after its parent is lost during disposal`: REQ-RUNTIME-3-VQXW59.T1.P52, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P16
- `exits the SDK worker after its failed setup loses the error reply`: REQ-RUNTIME-3-VQXW59.T1.P53, UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P17
- `reports a ready SDK worker exit once with its original cause`: REQ-RUNTIME-3-VQXW59.T1.P54, UNIT-TEST-ROOT-ERROR-1-0N4XM4.P7, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P2
- `acknowledges worker SDK abort with a worker executor before exiting while the parent is busy`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P18, REQ-RUNTIME-3-VQXW59.T1.P57, REQ-LOG-11-F5TJQC.T1.P14
- `reports executor worker exit through a worker SDK and rejects its pending call`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P19
- `disposes a worker SDK while its worker executor call is in flight`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P20, REQ-RUNTIME-3-VQXW59.T1.P78
- `acknowledges parent-requested worker SDK disposal before exiting while the parent is busy`: UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P21, REQ-RUNTIME-3-VQXW59.T1.P58
- `marks worker shutdown expected before parent port closure while client cleanup is held`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P3, REQ-RUNTIME-3-VQXW59.T1.P59
- `completes worker SDK disposal when a handle refuses a second close during the worker's handle close`: REQ-RUNTIME-7-A2VAR0.T1.P9, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P9
- `completes worker SDK disposal after the drain bound when the host leaks a referenced timer`: REQ-RUNTIME-7-A2VAR0.T1.P10, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P10
- `logs a report raised while its root disposes and raises it to nobody`: REQ-RUNTIME-3-VQXW59.T1.P87
- `disposes a worker runtime whose setup is held at its chain reads, and a fresh runtime for its signer works`: REQ-RUNTIME-3-VQXW59.T1.P88
- `disposes an inline runtime whose setup is held at its chain reads, and a fresh runtime for its signer works`: REQ-RUNTIME-3-VQXW59.T1.P89
- `cuts and disposes the runtime a worker setup builds after its disposal began, and a fresh runtime for its signer works`: REQ-RUNTIME-3-VQXW59.T1.P90
- `cuts and disposes the runtime an inline setup builds after its disposal ended, and a fresh runtime for its signer works`: REQ-RUNTIME-3-VQXW59.T1.P91

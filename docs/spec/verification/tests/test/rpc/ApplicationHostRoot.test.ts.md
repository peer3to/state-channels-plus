# ApplicationHostRoot.test.ts

Test file: [ApplicationHostRoot.test.ts](../../../../../../test/rpc/ApplicationHostRoot.test.ts)
Exercises: [P2pRuntimeHostRoot.ts.md](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)

## Overview

Each case starts one real runtime through the public `EvmStateMachine.p2pSetup` against a freshly
deployed manager stack, isolated in the SDK worker or inline. The test application gives two
manifests: its network root `ProbeRpc`, which declares `probeEvent` and emits it through the typed
`applicationEvents` accessor, and its host root `ProbeHostRoot`, which adds one internal `probe`
service over that network root. Other cases start with no host root manifest, or with one naming an
arrow-function export of the same module. The client calls the probe through the typed
`P2pInstance.host` connection and subscribes through the typed `P2pInstance.events`. Oracles: `echo`
returns the value with the runtime's signer address and records it, next to an SDK service answer;
without a manifest the SDK root serves its services and the probe call rejects as an unknown
endpoint; a non-class export rejects setup with the module named in the error; `fail` rejects with
the thrown name, message, and code; a probe call made from the deployment callback, before the
runtime is built, rejects as not ready. In the disposal case, `hang` never replies; disposing the
client while it runs must reject it with the runtime-disposed (disposed-child) error, and a later call
rejects with the same error. `emitProbeEvent` reaches the typed listener with its arguments by the time the
emitting call replies. In the second-build case the client deploys two fresh local state machines
through the deploy signer and calls `sdkSetup.deployComplete` with them after setup; the call must
reject with "Runtime already built" and the probe must still answer with the same signer address. In
the separately built case the test bundles `ProbeHostRoot` with esbuild into a temporary module that
carries its own copies of the probe, `P2pRuntimeHostRoot` and the config module, every other module
staying shared; the worker loads that module by manifest, and the probe's `readConfig` value of
`RUN_SDK_IN_THREAD` from its own copy must equal the peer's `true`.

## Tests

- `a host root loaded by manifest serves its own internal service in a worker`: REQ-RPC-9-8FFE6S.T1.P1, UNIT-TEST-HOST-ROOT-ENTRY-1-T7VY0Q.P2
- `a host root loaded by manifest serves its own internal service inline`: REQ-RPC-9-8FFE6S.T1.P2, UNIT-TEST-RESOLVE-HOST-ROOT-1-AS1DZ3.P1
- `without a manifest the default host root starts in a worker`: REQ-RPC-9-8FFE6S.T1.P3
- `without a manifest the default host root starts inline`: REQ-RPC-9-8FFE6S.T1.P4, UNIT-TEST-RESOLVE-HOST-ROOT-1-AS1DZ3.P2
- `a manifest whose export is not a class rejects setup in a worker`: REQ-RPC-9-8FFE6S.T1.P5, UNIT-TEST-HOST-ROOT-ENTRY-1-T7VY0Q.P3
- `a manifest whose export is not a class rejects setup inline`: REQ-RPC-9-8FFE6S.T1.P6, UNIT-TEST-RESOLVE-HOST-ROOT-1-AS1DZ3.P3
- `a failed build answers the setup promptly in a worker`: REQ-RPC-9-8FFE6S.T1.P17
- `a failed build answers the setup promptly inline`: REQ-RPC-9-8FFE6S.T1.P18
- `rejects with the service error's name, message and code in a worker`: REQ-RPC-9-8FFE6S.T1.P7
- `rejects with the service error's name, message and code inline`: REQ-RPC-9-8FFE6S.T1.P8
- `rejects a service call before the runtime is built`: REQ-RPC-9-8FFE6S.T1.P9
- `rejects a running service call and a later one at disposal in a worker`: REQ-RPC-9-8FFE6S.T1.P10
- `an application event emitted in the runtime reaches the client listener with its args in a worker`: REQ-RPC-9-8FFE6S.T1.P11
- `an application event emitted in the runtime reaches the client listener with its args inline`: REQ-RPC-9-8FFE6S.T1.P12
- `rejects a second deployComplete and keeps the original runtime serving in a worker`: REQ-RPC-9-8FFE6S.T1.P15
- `a worker host root compiled apart from the SDK reads its peer's config from its own config module`: REQ-RPC-9-8FFE6S.T1.P16

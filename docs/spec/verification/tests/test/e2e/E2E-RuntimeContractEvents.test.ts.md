# E2E-RuntimeContractEvents.test.ts

Test file: [test/e2e/E2E-RuntimeContractEvents.test.ts](../../../../../../test/e2e/E2E-RuntimeContractEvents.test.ts)

## Overview

A single regression test proves contract-event forwarding across the real runtime port: a
main-thread subscriber attaches with `contract.on(contract.filters.Addition(), ...)` on the
client-side contract instance whose runner is the provider-less `ClientP2pSigner`, then a real
`add(1)` transition runs so the host EVM parses a genuine `Addition` log and forwards it over the
port (worker mode crosses structured clone, so the serialization step is exercised too). The
oracle checks fidelity, not just delivery: exactly one event arrives, `b` equals the added `1n`,
and `result` equals `a + b` — real MathStateMachine semantics rather than a canned payload. It
guards the NoopEventProvider fix, where an event-incapable runner made ethers reject the
subscription so forwarded events reached no listener. Everything else about the runtime host
(request settlement, disposal, signing confinement) is out of scope and covered by the runtime
suites.

## Tests

- `delivers a real Addition event to a main-thread .on subscriber over the runtime port`: UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P4
- `delivers a real Addition event from an SDK worker`: none

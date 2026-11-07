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

Two more cases advance a real two-peer channel and subscribe to `onTurn` on the main-thread runtime
events, inline and with an SDK worker. Every turn must carry a numeric start timestamp and the
runtime's current chain time, and their difference must be the just-started turn's elapsed time:
between −3 s (whole-second sampling) and the turn time plus 3 s.

## Tests

- `delivers a real Addition event to a main-thread .on subscriber over the runtime port`: UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P4
- `delivers a real Addition event from an SDK worker`: none
- `delivers each onTurn with the runtime's current chain time`: REQ-TIME-6-61C1EV.T1.P1
- `delivers each onTurn with the runtime's current chain time from an SDK worker`: REQ-TIME-6-61C1EV.T1.P2

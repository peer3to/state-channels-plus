# LocalDiscoveryServer.ts

> **Source:** [src/utils/node/LocalDiscoveryServer.ts](../../../../../../../src/utils/node/LocalDiscoveryServer.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`INV-AUTH-1-J0PRYA` (Signature is the only proof)](../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya)
- [`REQ-AUTH-4-JWCF71` (Penalty requires proof, and clock faults are not proof)](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)

## UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5

Topic-owned local discovery lifecycle

- Setup: Use real loopback discovery, authenticated managers, transport close, blacklist, topic leave, and cleanup
- Oracle: One eligible replacement while observed; no replacement after leave, blacklist, or cleanup; at most one pending dial/retry per session peer

- [ ] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P1` — valid client-ready frame before cleanup acknowledges and starts one handshake
- [ ] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P2` — malformed ready frame closes without transport or handshake
- [ ] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P3` — valid ready frame after cleanup begins closes without acknowledgement, transport, or handshake
- [ ] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P4` — pending dial and retry callbacks cannot create a post-cleanup transport
- [x] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P5` — authenticated close creates a different transport while the exact topic remains observed
- [x] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P6` — topic leave stops later replacement
- [x] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P7` — blacklist plus close produces no replacement
- [x] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P8` — a peer with a live authenticated transport on another observed topic is not dialed again
- [x] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P9` — concurrent and repeated joins create one listener, leave removes it even during startup, and a later join establishes a usable session
- [x] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P10` — deduplicates an in-flight dial across topics before authentication
- [x] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P11` — an accepted socket sends its valid ready frame after manager disposal but before process-wide discovery cleanup; it closes without acknowledgement or a new transport; discovery can still log after manager disposal, and cleanup then disposes its logger and detaches its store
- [ ] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P12` — the replacement transport for a closed eligible peer appears no sooner than one second after the close
- [x] `UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P13` — an inbound reconnect inside the cooldown is held by the accepting peer server, admitted once the cooldown has passed, and blacklists neither side

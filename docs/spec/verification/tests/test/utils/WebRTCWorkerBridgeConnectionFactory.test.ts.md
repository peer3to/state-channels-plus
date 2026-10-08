# WebRTCWorkerBridgeConnectionFactory.test.ts

Test file: [test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts](../../../../../../test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts)
Exercises: [WorkerBridgeWebRTCConnectionFactory.ts](../../../../implementation/source/src/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md)

## Overview

Exercises real SDK-owned worker bridge roots, main-thread broker roots and native WebRTC providers. Cases cover negotiation, channel proxy traffic, peer callbacks, independent bridge instances, timeout and post failure, recursive disposal and external broker attachment after readiness. The delayed-attachment cases also check port-wait timeout, attachment notification and clearing the default adapter after disposal.

## Tests

- `keeps another bridge usable when the first bridge is disposed`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P8
- `accepts a real remote offer and exchanges channel data`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P9
- `keeps missing-peer answer ICE and close operations as no-ops`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P10
- `recovers negotiation after a synchronous post failure`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P11
- `ignores a late negotiation response after an explicit timeout`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P12
- `creates a proxy data channel from bridge channel events`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P13
- `routes bridge state and ICE events to connection callbacks`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P14
- `rejects in-flight requests when the shared bridge is disposed`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P4
- `keeps recursive bridge disposal idempotent`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P15
- `delivers real connection changes only to replacement callbacks`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P16
- `ignores retired provider channel callbacks after reconnect`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P17
- `sends only one proxy close while closing and after closure`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P18
- `WorkerBridgeWebRTCConnectionFactory > becomes ready before broker attachment and resumes queued negotiation after attachment`: UNIT-TEST-BRIDGE-ROOT-1-K5XX3Y.P1, REQ-RUNTIME-3-VQXW59.T1.P46
- `WorkerBridgeWebRTCConnectionFactory > disposes an unattached broker connection and rejects queued negotiation`: UNIT-TEST-BRIDGE-ROOT-1-K5XX3Y.P2, REQ-RUNTIME-3-VQXW59.T1.P47
- `delivers broker errors and an abnormal bridge closure to the owner`: UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P21

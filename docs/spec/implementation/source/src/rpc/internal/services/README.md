# src/rpc/internal/services

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

Explicit RPC composition and its service dependencies. Network and internal capabilities remain separate; importing a file does not register endpoints.


Common services are lifecycle, logger and errors. Concrete roots explicitly add SDK setup, signers, executor, client notifications and bridge services. Shared routing, dispatch and transport code supplies machinery rather than domain capabilities.

## Source inventory

| Source | Report |
| --- | --- |


## Contents

- [chainSigner](./chainSigner/README.md)
- [contractExecutor](./contractExecutor/README.md)
- [deploySigner](./deploySigner/README.md)
- [errors](./errors/README.md)
- [hostRpc](./hostRpc/README.md)
- [lifecycle](./lifecycle/README.md)
- [logger](./logger/README.md)
- [p2pSigner](./p2pSigner/README.md)
- [sdkSetup](./sdkSetup/README.md)
- [sdkClient](./sdkClient/README.md)
- [webRTCBridge](./webRTCBridge/README.md)
- [webRTCNegotiation](./webRTCNegotiation/README.md)

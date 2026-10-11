# HolepunchTransport.ts

> **Source:** [src/transport/HolepunchTransport.ts](../../../../../../src/transport/HolepunchTransport.ts)

## Requirements

- [`REQ-AUTH-3-ZV74KB` (Completion requires both roles)](../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb)
- [`REQ-UPG-4-M2XDBA` (Fallback ban and explicit exclusion)](../../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba)

## UNIT-TEST-HOLEPUNCH-TRANSPORT-1-5KCTA2

Every socket error closes the transport at its log level

- Setup: Open two Holepunch transports on a real manager and record its logger's warnings and errors; emit an `ECONNRESET` error on one socket and a different error on the other.
- Oracle: The reset is one warning "Holepunch peer reset the connection" and no error; the other error is one error "Holepunch socket error"; both transports are closed.

- [x] `UNIT-TEST-HOLEPUNCH-TRANSPORT-1-5KCTA2.P1` — a peer's connection reset (`ECONNRESET`) logs one warning and closes the transport
- [x] `UNIT-TEST-HOLEPUNCH-TRANSPORT-1-5KCTA2.P2` — any other socket error logs one error and closes the transport

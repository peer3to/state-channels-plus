# HolepunchTransport.ts

> **Source:** [src/transport/HolepunchTransport.ts](../../../../../../src/transport/HolepunchTransport.ts)

## Requirements

- [`REQ-AUTH-3-ZV74KB` (Completion requires both roles)](../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb)
- [`REQ-UPG-4-M2XDBA` (Fallback ban and explicit exclusion)](../../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba)

## UNIT-TEST-HOLEPUNCH-TRANSPORT-1-5KCTA2

Every socket error closes the transport at its log level

- Setup: Open four Holepunch transports on a real manager and record its logger's debug messages, warnings and errors; emit Hyperswarm's `Duplicate connection` error on one socket, an `ECONNRESET` error on another, an error that carries only the message `connection reset by peer` (as dht-relay forwards a remote reset) on the third, and a different error on the fourth.
- Oracle: The duplicate is a debug message "Holepunch dropped a duplicate connection"; each reset, with or without its code, is one warning "Holepunch peer reset the connection" and no error; the other error is one error "Holepunch socket error"; every transport is closed.

- [x] `UNIT-TEST-HOLEPUNCH-TRANSPORT-1-5KCTA2.P1` — a peer's connection reset (`ECONNRESET`) logs one warning and closes the transport
- [x] `UNIT-TEST-HOLEPUNCH-TRANSPORT-1-5KCTA2.P2` — any other socket error logs one error and closes the transport
- [x] `UNIT-TEST-HOLEPUNCH-TRANSPORT-1-5KCTA2.P3` — a connection Hyperswarm drops as a duplicate (`Duplicate connection`) logs at debug level and closes the transport
- [x] `UNIT-TEST-HOLEPUNCH-TRANSPORT-1-5KCTA2.P4` — a peer reset that carries only the message `connection reset by peer` (no code) logs one warning, no error, and closes the transport

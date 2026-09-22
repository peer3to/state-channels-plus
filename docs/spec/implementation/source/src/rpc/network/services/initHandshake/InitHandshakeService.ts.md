# InitHandshakeService.ts

> **Source:** [src/rpc/network/services/initHandshake/InitHandshakeService.ts](../../../../../../../../../src/rpc/network/services/initHandshake/InitHandshakeService.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/handshake.md](../../../../../../views/architecture/sdk/rpc/handshake.md)

## Requirements

- [`INV-AUTH-1-J0PRYA` (Signature is the only proof)](../../../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya)
- [`INV-AUTH-2-VQ6D54` (Domain separation)](../../../../../../../specification/peer-communication/handshake.md#inv-auth-2-vq6d54)
- [`INV-AUTH-3-0QP5E9` (Objective facts only)](../../../../../../../specification/peer-communication/handshake.md#inv-auth-3-0qp5e9)
- [`REQ-AUTH-2-BQ5CRG` (Fresh single-use challenges)](../../../../../../../specification/peer-communication/handshake.md#req-auth-2-bq5crg)
- [`REQ-AUTH-3-ZV74KB` (Completion requires both roles)](../../../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb)
- [`REQ-AUTH-4-JWCF71` (Penalty requires proof, and clock faults are not proof)](../../../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)
- [`REQ-AUTH-6-E7SSH3` (Initiator verification and bidirectional clock compatibility)](../../../../../../../specification/peer-communication/handshake.md#req-auth-6-e7ssh3)
- [`REQ-UPG-4-M2XDBA` (Fallback ban and explicit exclusion)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba)
- [`REQ-UPG-3-T1SRMS` (Single deterministic initiator)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-3-t1srms)
- [`REQ-RPC-8-44XECF` (Compatibility before protected calls)](../../../../../../../specification/peer-communication/rpc.md#req-rpc-8-44xecf)
  Missing: No compatibility scheme exists anywhere — incompatible peers fail via downstream errors instead of clean refusal ([`OQ-34-FY08V2` (RPC boundary decisions)](../../../../../../../specification/open-questions.md#oq-34-fy08v2), coupled to [`OQ-29-EFY4NF` (Signature domain separation)](../../../../../../../specification/open-questions.md#oq-29-efy4nf)).
- [`REQ-TRUST-6-Z586T0` (Temporary assumption A9)](../../../../../../../specification/security/trust-model.md#req-trust-6-z586t0)

## UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R

Initiator flow and finalization

- Setup: Run exchanges to every partial state; replay/forge responses; race bidirectional completion
- Oracle: Only correct fresh-challenge signatures verify; finalization fires once with both roles; timeouts split by proof state

- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P1` — correct mutual completion
- [ ] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P2` — forged response
- [ ] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P3` — RTT bound at edge
- [ ] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P4` — verified-only stall
- [ ] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P5` — idempotent finalization race
- [ ] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P6` — unverified timeout drop
- [ ] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P7` — replayed response
- [ ] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P8` — skew bound at edge
- [ ] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P9` — acked-only stall
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P10` — a verified peer's missing acknowledgement records one strike and no suspension
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P11` — a response timestamp ahead of the window records one strike
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P12` — a round trip beyond the agreement window records one strike
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P13` — a refused challenge records one strike and no verdict
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P14` — the third missing acknowledgement suspends the key and the proven address together
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P15` — a response timestamp behind the window records one strike
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P16` — a response timestamp exactly on the window bound is accepted
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P17` — a round trip exactly equal to the agreement time is accepted
- [x] `UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P18` — a valid response is acknowledged, the transport stays open, and no strike is recorded

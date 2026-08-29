# test/transport/MessagePortTransport.test.ts — Test Report

> **Test file:** [test/transport/MessagePortTransport.test.ts](../../../../../../test/transport/MessagePortTransport.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [MessagePortTransport](../../../../implementation/source/src/transport/MessagePortTransport.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite attaches real `MessageChannel` ports under real routers and checks the transport's
three properties: it is trusted and of its own type, the envelope crosses as an object rather than
a serialized string (read off a spy port), and closure from the far end closes this end and rejects
its requests while an expected close settles them as disposed without a failure log.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                    | Covers                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`MessagePortTransport > is a trusted transport of its own type`](../../../../../../test/transport/MessagePortTransport.test.ts#L16) (line 16)                                      | [`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4.P1`](../../../../implementation/source/src/transport/MessagePortTransport.ts.md#unit-test-message-port-transport-1-h9t8b4.p1) |
| [`MessagePortTransport > posts the envelope itself, not a serialized string`](../../../../../../test/transport/MessagePortTransport.test.ts#L25) (line 25)                          | [`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4.P2`](../../../../implementation/source/src/transport/MessagePortTransport.ts.md#unit-test-message-port-transport-1-h9t8b4.p2) |
| [`MessagePortTransport > the far end closing its port closes this transport and rejects its requests`](../../../../../../test/transport/MessagePortTransport.test.ts#L45) (line 45) | [`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4.P3`](../../../../implementation/source/src/transport/MessagePortTransport.ts.md#unit-test-message-port-transport-1-h9t8b4.p3) |
| [`MessagePortTransport > an expected close settles pending requests as disposed, not as a failure`](../../../../../../test/transport/MessagePortTransport.test.ts#L61) (line 61)    | [`UNIT-TEST-MESSAGE-PORT-TRANSPORT-1-H9T8B4.P4`](../../../../implementation/source/src/transport/MessagePortTransport.ts.md#unit-test-message-port-transport-1-h9t8b4.p4) |

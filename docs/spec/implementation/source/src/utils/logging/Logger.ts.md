# Logger.ts

> **Source:** [src/utils/logging/Logger.ts](../../../../../../../src/utils/logging/Logger.ts)
>
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)
- [`REQ-LOG-3-T9FM2K` (Writing a log line does not disturb the session)](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)
- [`REQ-LOG-4-W5XR7Q` (Every line says where it came from)](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)
- [`REQ-LOG-9-V6SMAC` (An application report records its reason)](../../../../../specification/runtime/log-collection.md#req-log-9-v6smac)

## UNIT-TEST-LOGGER-1-4MNRMD

The logger's own boundary: defaults, disposal, and what it lets through.

- Setup: Create loggers through the public factory and the uploader fixture; write, dispose, and read back through a real receiver.
- Oracle: A default thread name; a store with no surviving logger detached from the optional service; a non-string message stored as a string.

- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P1` — the thread name defaults to main
- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P2` — the last disposed logger detaches its store from the optional service
- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P3` — a non-string message is coerced at the boundary
- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P4` — starts once across logger instances, ignores duplicate starts, stops once, restarts after stop and preserves monitoring when a non-owner is disposed
- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P5` — reparents children to the surviving grandparent and keeps upload working
- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P6` — keeps one shared store usable across parentless siblings and removes it after the last disposal
- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P7` — retains shared crash listeners until the last logger is disposed
- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P8` — cascades through reparented grandchildren and rejects child creation after disposal
- [ ] `UNIT-TEST-LOGGER-1-4MNRMD.P9` — continues collecting an SDK store after its parent logger is disposed while children remain alive
- [x] `UNIT-TEST-LOGGER-1-4MNRMD.P10` — every log level and direct entry replay throws with the component name after disposal, including filtered levels, while repeated disposal is harmless

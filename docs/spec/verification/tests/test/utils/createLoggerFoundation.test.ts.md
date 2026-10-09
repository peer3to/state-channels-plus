# createLoggerFoundation.test.ts

Test file: [createLoggerFoundation.test.ts](../../../../../../test/utils/createLoggerFoundation.test.ts)
Exercises: [createLoggerFoundation.ts.md](../../../../implementation/source/src/utils/logging/createLoggerFoundation.ts.md)

## Overview

Build real stores under temporary config values; inspect defaults, explicit false, uploader options, disabled storage, fallback size and distinct instances.

## Tests

- `uses config defaults and allocates a distinct store per call`: UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P1
- `preserves explicit false and uploader options`: UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P2
- `disables storage when upload is disabled`: UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P3
- `uses the default store size for zero configuration`: UNIT-TEST-CREATE-LOGGER-FOUNDATION-32-1NHGFC.P4

# BrowserLogger.ts

> **Source:** [src/utils/logging/browser/BrowserLogger.ts](../../../../../../../../src/utils/logging/browser/BrowserLogger.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

No specified behavior: Browser logger implementation (console adapters).

## UNIT-TEST-BROWSER-LOGGER-1-6FCT8F

Browser logger integration

- Setup: Use the real browser logger and store.
- Oracle: The recorded warning retains browser-specific metadata.

- [x] `UNIT-TEST-BROWSER-LOGGER-1-6FCT8F.P1` — browser logger stores long-task warning metadata with estimated utilization and no Node utilization field

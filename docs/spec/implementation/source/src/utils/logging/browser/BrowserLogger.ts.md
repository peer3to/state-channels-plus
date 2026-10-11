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

## UNIT-TEST-BROWSER-LOGGER-THREAD-LABEL-1-5ZFBPM

Every rendered line names its thread

- Setup: In the browser gate page, write one info line with peer and component context through a real `BrowserLogger` and capture its console group label for that write only; vary the shared context's thread name: absent, `main`, `sdk`, `vm` and a consumer name (`prover`).
- Oracle: Exactly one rendered label; with its `%c` style markers removed it is time, level, peer, exactly one thread label, component, then the unchanged message; an absent name renders `main`.

- [x] `UNIT-TEST-BROWSER-LOGGER-THREAD-LABEL-1-5ZFBPM.P1` — a line whose context names no thread renders `[main]`
- [x] `UNIT-TEST-BROWSER-LOGGER-THREAD-LABEL-1-5ZFBPM.P2` — a `main` line renders `[main]`
- [x] `UNIT-TEST-BROWSER-LOGGER-THREAD-LABEL-1-5ZFBPM.P3` — an `sdk` line renders `[sdk]`
- [x] `UNIT-TEST-BROWSER-LOGGER-THREAD-LABEL-1-5ZFBPM.P4` — a `vm` line renders `[vm]`
- [x] `UNIT-TEST-BROWSER-LOGGER-THREAD-LABEL-1-5ZFBPM.P5` — a consumer `prover` line renders `[prover]`

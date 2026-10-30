# RootWorkerRuntime.ts

> **Source:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/browser/RootWorkerRuntime.ts)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-RUNTIME-7-A2VAR0` (Bounded isolated-context teardown)](../../../../../../specification/runtime/execution.md#req-runtime-7-a2var0)
- [`REQ-CONFIG-4-WW7BRX` (Isolated contexts start with their creator's configuration)](../../../../../../specification/runtime/configuration.md#req-config-4-ww7brx)
- [`REQ-RUNTIME-8-M3ENFM` (An isolated context's failure names its cause)](../../../../../../specification/runtime/execution.md#req-runtime-8-m3enfm)
- [`REQ-LOG-10-69CTN1` (A thread that is ending waits only for its own logs)](../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1)
- [`REQ-RUNTIME-9-P5VPT5` (An uncaught non-error failure is reported as one error)](../../../../../../specification/runtime/execution.md#req-runtime-9-p5vpt5)

## UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX

Browser detached-error reporting

- Setup: Create the browser worker executor with a scripted entry through the gate page; arm each failure and keep calling
- Oracle: One detached report per arm with the worker still serving; no worker `error` event and no console error

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P1` — a watchdog trip is one report with `runtime: "browser"` delay data
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P2` — an autonomous throw is one report
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P3` — an unhandled rejection is one report
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P4` — a real browser worker loads the custom precompile and returns its expected contract result

## UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR

Browser root worker failure cause and drain

- Setup: Through the gate page, create parentless browser worker roots from a script that answers 404, a script whose requests are aborted, an unparsable script, an unparsable script that the server changes before the diagnostic fetch, and a script that throws at top level; make the owner's failure log write throw. On a recorded worker, dispatch an `ErrorEvent` with no message, a second bare `error` event while the diagnostic fetch of the first runs, and an `ErrorEvent` on a ready worker before its disposal. Dispose a ready logger-probe root right after an error-level line, one whose upload outlasts the drain bound, and that one again with a drain warning write that throws.
- Oracle: Creation rejects with the summary that names the cause; the owner logs one error-level `Root worker failed` line with `eventType`, `workerUrl`, `workerName` and `msSinceSpawn`, plus the host's message and position for an `ErrorEvent`, or `received` (the browser's recorded load of the script, or `null`) and `fetched` for a load or parse failure; the drain ends on the child's closing message, or at `CRASH_LOG_FLUSH_MS` plus the 1 s close margin with one warning that carries `workerUrl`, `workerName` and `drainTimeoutMs`; a throwing log write changes neither outcome and is reported as uncaught.

- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P1` — a 404 script fails with `failed to load (HTTP 404)` and its absolute URL; the log carries `eventType` `Event`, `received` `null` and `fetched.status` 404
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P2` — a script whose diagnostic fetch also fails fails with `failed to load (the browser's request failed; a fetch now fails: …)` and its URL; `received` is `null` and `fetched` holds only the fetch error
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P3` — an unparsable script fails with `failed to parse or link (the browser received HTTP 200, 16 bytes; a fetch now returns HTTP 200, 16 bytes)` and its URL; `received` holds status 200 and the 16 bytes, `fetched` the status, content type and size
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P4` — a top-level throw fails with `Root worker failed: <message> (<file>:<line>:<col>)`; the log carries `eventType` `ErrorEvent`, the message and the position, and no `fetched`
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P5` — an `ErrorEvent` with no message fails with `Root worker failed with no error message (<position>)` ([`REQ-RUNTIME-8-M3ENFM.T1.P6`](../../../../../../specification/runtime/execution.md#req-runtime-8-m3enfm.t1.p6))
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P6` — a failure log write that throws still fails the root with the same summary, and the write error is reported as uncaught
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P7` — a ready worker disposed right after an error-level line posts its closing message after its upload settled; the drain ends before the flush bound, and the line is stored when the disposal returns
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P8` — a ready worker that does not close within `CRASH_LOG_FLUSH_MS` plus 1 s: the disposal ends no earlier than that bound and before the worker's own upload ends, with one warning that carries `workerUrl`, `workerName` and `drainTimeoutMs`
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P9` — a drain warning write that throws leaves no stored warning, is reported as uncaught, and the disposal still ends no earlier than the drain bound and before the worker's own upload ends
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P10` — a second load or parse failure event of a worker whose script fetch already started neither fetches nor reports again ([`REQ-RUNTIME-8-M3ENFM.T1.P7`](../../../../../../specification/runtime/execution.md#req-runtime-8-m3enfm.t1.p7))
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P11` — a worker that failed ends its drain at once ([`REQ-RUNTIME-7-A2VAR0.T1.P15`](../../../../../../specification/runtime/execution.md#req-runtime-7-a2var0.t1.p15))
- [x] `UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR.P12` — an unparsable script that the server changes before the diagnostic fetch fails with the 16 bytes the browser received and the 28 bytes the fetch now returns

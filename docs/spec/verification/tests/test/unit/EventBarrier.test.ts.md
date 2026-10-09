# EventBarrier.test.ts

Test file: [test/unit/EventBarrier.test.ts](../../../../../../test/unit/EventBarrier.test.ts)
Exercises: [EventBarrier.ts](../../../../implementation/source/src/utils/EventBarrier.ts.md)

## Overview

The suite exercises the `EventBarrier` wait/signal utility directly through the test fixtures
`createTestEventBarrier` and `createRecordingEventBarrier` (the latter captures error logs), with
no channel or harness session involved. Each test builds a barrier, races `waitFor` conditions
against `signal()` calls and the deadline, and asserts settlement behavior: resolution when the
condition turns true on a signal (including a signal landing while the initial check is still in
flight), bounded rejection when the condition hangs from the first or a later check, timeout
message selection when the diagnostic message function hangs or the meta function throws,
deadline-side resolution when state changed without any signal, condition exceptions propagating
to the waiter, and the barrier staying usable after a rejected wait. The recording fixture pins
the single-settle guard: an initial check resolving after the deadline fired must produce exactly
one resolution with no late timeout or missing-signal log. Oracles are promise
resolution/rejection, error-message content, elapsed-time bounds, and recorded log silence. The
component's implementation report defines no test obligations and no specification permutation
targets this utility, so no test IDs are assignable to this suite.

## Tests

- `resolves on signal when the condition turns true`: none
- `resolves promptly when the signal lands while the initial check is still in flight`: none
- `rejects at the deadline when the condition hangs from the first check`: none
- `settles once with no late timeout log when the initial check resolves while the deadline check is pending`: none
- `rejects with the original timeout when the timeout message diagnostic hangs`: none
- `rejects with the original timeout when the timeout meta diagnostic throws`: none
- `rejects at the deadline when the condition returns false once and then hangs`: none
- `resolves at the deadline when the condition turned true but no signal ever woke it`: none
- `times out with the given message when the condition never turns true`: none
- `rejects the waiter when the condition throws (from signal or interval)`: none

# test/utils/LogUploader.test.ts — Test Report

> **Test file:** [test/utils/LogUploader.test.ts](../../../../../../test/utils/LogUploader.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [LogUploader.ts](../../../../implementation/source/src/utils/logging/LogUploader.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs the real `LogUploader` against an actual local HTTP receiver
(`startLogReceiver`/`createUploaderFixture` from the logging fixtures), so the oracle is the
decoded body of the POST the receiver captures — not internal state. The cases assert: a
captured genuine `AxiosError` uploads with its name/code/message while none of its config
secrets (auth header, cookie, request body) appear anywhere in the payload; `uploadLogs` with
nothing captured delivers the routine entry written before it; an error captured while an upload sits in its jitter
sleep still lands in the single delivered POST; and the crash handler survives hostile inputs —
a rejection reason whose `toString` throws uploads as `[unstringifiable rejection reason]`, and
an `Error` whose name/message/stack/code accessors throw uploads as `[unreadable]` — without
itself throwing. Retry/backoff policy, size caps, and the browser wiring of
`captureUnhandled` to window events are out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                              | Covers                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`LogUploader > uploads a captured error without leaking secret fields of a real AxiosError`](../../../../../../test/utils/LogUploader.test.ts#L26) (line 26) | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P10`](../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p10) |
| [`LogUploader > uploads logs when no error is captured`](../../../../../../test/utils/LogUploader.test.ts#L58) (line 58)                                      | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P8`](../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p8)   |
| [`LogUploader > delivers a captured error that arrives while an upload is in flight`](../../../../../../test/utils/LogUploader.test.ts#L75) (line 75)         | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P9`](../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p9)   |
| [`LogUploader > captures a non-Error reason whose toString throws without itself throwing`](../../../../../../test/utils/LogUploader.test.ts#L94) (line 94)   | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P11`](../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p11) |
| [`LogUploader > captures an Error with throwing accessors without itself throwing`](../../../../../../test/utils/LogUploader.test.ts#L114) (line 114)         | [`UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P12`](../../../../implementation/source/src/utils/logging/LogUploader.ts.md#unit-test-log-uploader-1-tbrv7k.p12) |

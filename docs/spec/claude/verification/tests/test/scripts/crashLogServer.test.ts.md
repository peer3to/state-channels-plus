# test/scripts/crashLogServer.test.ts — Test Report

> **Test file:** [test/scripts/crashLogServer.test.ts](../../../../../../../test/scripts/crashLogServer.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests `sanitizeSegment` from the CommonJS dev script `scripts/logging/crash-log-server.js`, required directly without starting the server (its `start()` is guarded by `require.main === module`). The threat model is path traversal: `channelId` and `peerAddress` arrive from remote peers and are used to build on-disk paths under `LOG_DIR`. The oracles assert that legitimate hex channel ids and addresses pass through unchanged, that every disallowed character is replaced with `_`, and that for a set of hostile inputs (`../` chains, backslash traversal, absolute paths, bare `..`) no path separator survives and `path.resolve(LOG_DIR, ...)` stays inside `LOG_DIR`. The running server, its HTTP endpoints, and actual log persistence are out of scope. The component under test is developer logging tooling, not a production protocol component, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                  | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`crash-log-server sanitizeSegment - path traversal > leaves legitimate hex ids / addresses unchanged`](../../../../../../../test/scripts/crashLogServer.test.ts#L20) (line 20)   | —      |
| [`crash-log-server sanitizeSegment - path traversal > replaces every disallowed character with _`](../../../../../../../test/scripts/crashLogServer.test.ts#L27) (line 27)        | —      |
| [`crash-log-server sanitizeSegment - path traversal > keeps a sanitized segment contained under LOG_DIR`](../../../../../../../test/scripts/crashLogServer.test.ts#L31) (line 31) | —      |

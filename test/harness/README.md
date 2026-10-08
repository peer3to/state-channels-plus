# Test harness

The shared leave watchdog is 60 seconds. Only tests whose subject is watchdog behavior override it. The production default remains 15 seconds.

The snapshot-update suite keeps its shared 6-second evidence window by owner decision. Leave-phase waits poll the existing state query because a phase change has no dedicated event. Monitor tests inject a real logger from the test tree; production exposes no test-only logger or Clock options.

## Open security questions

**The harness control manifest can run code before peer authentication**
(Codex Security scan `b16b8056-1a2e-47ad-b510-34ef96ce1d0b`, finding
`csf_9ab7cede3f992354ca5b0bd8`; needs review, low). The default test manifest
has no guards, and `scenario.exec` evaluates a received body
([HarnessControlRpc.ts:38](../fixtures/customRpc/harnessControl/HarnessControlRpc.ts#L38),
[ScenarioRpcMethods.ts:30-42](../fixtures/customRpc/harnessControl/services/scenario/ScenarioRpcMethods.ts#L30-L42)).
The loopback listener has no Origin check and accepts calls before the
handshake completes. This is intentional for a code-executing test fixture,
and same-user local processes are not a security boundary. It becomes a
defect only if an untrusted browser origin can reach the listener in a
supported developer setup.

- Open question: is an untrusted browser origin that reaches the loopback
  harness a supported threat?
- If yes: add a local-only execution guard that keeps the required probes
  working.

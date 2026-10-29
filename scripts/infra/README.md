# Local infrastructure scripts

- `local-discovery-registry.js` (`yarn infra:local-discovery`): the local
  peer discovery registry. It listens on `127.0.0.1:19777` by default
  (`LOCAL_DISCOVERY_HOST`, `LOCAL_DISCOVERY_PORT`).
- `run-e2e-worker.js`: runs the end-to-end suite in worker mode
  (`RUN_SDK_IN_THREAD=true`) against an external Hardhat node.
- `start-hardhat-node.js`: starts that Hardhat node, on `127.0.0.1:18545` by
  default.

## Open security questions

**A malformed registration can stop the local discovery registry** (Codex
Security scan `b16b8056-1a2e-47ad-b510-34ef96ce1d0b`, finding
`csf_638ea73947731f98d7f29fdf`; needs review, low). A JSON `null` message
parses successfully, then `Number(parsed.port)` throws outside the `try`
([local-discovery-registry.js:26-36](./local-discovery-registry.js#L26-L36)).
The registry listens on loopback by default and has no Origin check
([local-discovery-registry.js:5-10](./local-discovery-registry.js#L5-L10)).
A trusted same-user caller can already stop its own development process, so
this is a security issue only if an untrusted browser can connect, or if an
externally bound deployment is supported.

- Open question: is an untrusted browser origin that reaches the registry a
  supported threat?
- Whatever the answer: reject a message that is not a JSON object before
  reading its fields. This is a plain robustness fix.

// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import path from "path";

// The crash-log server is a CommonJS dev script. Its start() is guarded by
// `require.main === module`, so requiring it here only imports the helper and
// does not spin up a server.
const { sanitizeSegment } =
    require("../../scripts/logging/crash-log-server.js") as {
        sanitizeSegment: (value: unknown) => string;
    };

/**
 * Regression: channelId / peerAddress are attacker-controlled and used to build
 * on-disk paths under LOG_DIR. sanitizeSegment must neutralize any path
 * traversal so a crafted value can't write/read outside the log directory.
 */
describe("crash-log-server sanitizeSegment - path traversal", function () {
    const LOG_DIR = "/var/crash-logs";

    it("leaves legitimate hex ids / addresses unchanged", function () {
        const channelId = "0x" + "ab".repeat(32);
        const address = "0x" + "cd".repeat(20);
        expect(sanitizeSegment(channelId)).to.equal(channelId);
        expect(sanitizeSegment(address)).to.equal(address);
    });

    it("replaces every disallowed character with _", function () {
        expect(sanitizeSegment("a.b/c\\d:e")).to.equal("a_b_c_d_e");
    });

    it("keeps a sanitized segment contained under LOG_DIR", function () {
        for (const evil of [
            "../../../../tmp/pwn",
            "..\\..\\windows",
            "/etc/passwd",
            "../secret",
            ".."
        ]) {
            const safe = sanitizeSegment(evil);
            // No separators survive...
            expect(safe).to.not.match(/[/\\]/);
            // ...and joining it under LOG_DIR cannot escape LOG_DIR.
            const resolved = path.resolve(LOG_DIR, `${safe}_ts`);
            expect(
                resolved.startsWith(path.resolve(LOG_DIR) + path.sep)
            ).to.equal(true);
        }
    });
});

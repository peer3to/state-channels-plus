const fs = require("node:fs/promises");
const path = require("node:path");
const { callService } = require("./client");
const { receipt, request } = require("./protocol");
const { DEFAULTS } = require("./config");
const { check } = require("./data");
const { sanitized } = require("./errors");
const { clientSeed } = require("./identity");
async function main() {
    const root = process.argv[2];
    check(root);
    const input = request(
        JSON.parse(await fs.readFile(path.join(root, "request.json"), "utf8"))
    );
    const result = JSON.parse(
        await fs.readFile(path.join(root, "result.json"), "utf8")
    );
    const publication = JSON.parse(
        await fs.readFile(path.join(root, "publication.json"), "utf8")
    );
    const superseded = publication.status === "superseded";
    if (!superseded) receipt(publication.receipt, input);
    await callService({
        request: input,
        operation: superseded ? "acknowledgement" : "receipt",
        payload: {
            executionId: result.executionId,
            ...(superseded ? {} : { receipt: publication.receipt })
        },
        stateRoot: process.env.SCP_REVIEW_CLIENT_STATE,
        secret: process.env.SCP_TEST_POOL_SECRET,
        seed: clientSeed(),
        limits: {
            ...DEFAULTS,
            queueMs: 60000,
            setupMs: 60000,
            modelMs: 1,
            validationMs: 1
        },
        onProgress: (message) => console.log(message)
    });
    console.log(
        superseded
            ? "Superseded review retained; publication ownership released."
            : "Confirmed receipt recorded by the review service."
    );
}
if (require.main === module)
    main().catch((error) => {
        console.error(sanitized(error).message);
        process.exitCode = 1;
    });
module.exports = { main };

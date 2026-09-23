const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PublicationStore } = require("../../publication-store");
const roots = [];
function publicationStore() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-publication-"));
    roots.push(root);
    return new PublicationStore(root);
}
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
module.exports = { publicationStore };

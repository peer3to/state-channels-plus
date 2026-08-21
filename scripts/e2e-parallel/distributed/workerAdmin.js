/* eslint-disable no-console */
const fs = require("fs");
const { WorkerAuditLog } = require("./auditLog");
const { AuthorizationStore } = require("./authorizationStore");

function parseArgs(argv) {
    const command = argv[2];
    const options = {};
    for (let index = 3; index < argv.length; index++) {
        const flag = argv[index];
        if (!new Set(["--work-root", "--output", "--public-key"]).has(flag)) {
            throw new Error(`Unknown worker admin option: ${flag}`);
        }
        const value = argv[++index];
        if (!value || value.startsWith("--")) {
            throw new Error(`${flag} requires a value`);
        }
        options[
            flag
                .slice(2)
                .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
        ] = value;
    }
    if (!options.workRoot) throw new Error("--work-root is required");
    return { command, ...options };
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    if (options.command === "audit-show") {
        process.stdout.write(new WorkerAuditLog(options.workRoot).read());
    } else if (options.command === "audit-export") {
        if (!options.output) throw new Error("audit-export requires --output");
        const audit = new WorkerAuditLog(options.workRoot);
        if (!fs.existsSync(audit.file))
            throw new Error("Audit log does not exist");
        console.log(audit.exportTo(options.output));
    } else if (options.command === "authorization-list") {
        console.log(
            JSON.stringify(
                new AuthorizationStore(options.workRoot).list(),
                null,
                2
            )
        );
    } else if (options.command === "authorization-bootstrap-admin") {
        if (!options.publicKey) {
            throw new Error(
                "authorization-bootstrap-admin requires --public-key"
            );
        }
        const authorization = new AuthorizationStore(options.workRoot, {
            adminPublicKeys: [options.publicKey]
        });
        if (!authorization.isAdmin(options.publicKey)) {
            throw new Error(
                "Authorization state already exists without this admin; use a current admin to add it remotely"
            );
        }
        console.log(`Bootstrapped admin ${options.publicKey.slice(0, 12)}`);
    } else {
        throw new Error(
            "Command must be audit-show, audit-export, authorization-list, or authorization-bootstrap-admin"
        );
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { main, parseArgs };

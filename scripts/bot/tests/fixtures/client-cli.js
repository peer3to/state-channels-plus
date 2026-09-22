const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const {
    createPool
} = require("../../../e2e-parallel/distributed/poolTransport");
const { clientSeed } = require("../../identity");

// Execute the real CLI argument/file path. Inject only local discovery configuration;
// authentication, client transport, protocol and atomic output writes remain real.
async function runClientCli(argv, env, node) {
    const filename = path.resolve(__dirname, "../../client.js");
    const load = createRequire(filename);
    const localRequire = (name) => {
        if (name === "../e2e-parallel/distributed/poolTransport")
            return {
                ...load(name),
                createPool: (options) => createPool({ ...options, dht: node() })
            };
        if (name === "./identity") return { clientSeed: () => clientSeed(env) };
        return load(name);
    };
    const module = { exports: {} };
    const source = await fs.readFile(filename, "utf8");
    const run = vm.runInThisContext(
        `(function(require,module,process){${source}\nreturn main;})`,
        { filename }
    )(localRequire, module, { argv: ["node", filename, ...argv], env });
    return run();
}
// Run the production owners unchanged, replacing only process/discovery config.
async function configuredOwner(name, argv, env, options) {
    const filename = path.resolve(__dirname, `../../${name}.js`);
    const load = createRequire(filename);
    const localRequire = (id) => {
        if (id === "./client")
            return {
                ...load(id),
                callService: (args) =>
                    load(id).callService({
                        ...args,
                        ...options,
                        dht:
                            typeof options.dht === "function"
                                ? options.dht()
                                : options.dht
                    })
            };
        if (id === "./identity") return { clientSeed: () => clientSeed(env) };
        return load(id);
    };
    const module = { exports: {} };
    const source = await fs.readFile(filename, "utf8");
    vm.runInThisContext(`(function(require,module,process){${source}\n})`, {
        filename
    })(localRequire, module, { argv: ["node", filename, ...argv], env });
    return module.exports;
}
module.exports = { runClientCli, configuredOwner };

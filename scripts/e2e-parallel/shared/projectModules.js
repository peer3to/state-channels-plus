const path = require("path");

function resolveProjectModule(request, projectRoot = process.cwd()) {
    return require.resolve(request, {
        paths: [path.resolve(projectRoot)]
    });
}

function resolveProjectHardhatCli(projectRoot = process.cwd()) {
    return resolveProjectModule("hardhat/internal/cli/cli.js", projectRoot);
}

module.exports = {
    resolveProjectModule,
    resolveProjectHardhatCli
};

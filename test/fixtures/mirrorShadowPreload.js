// @spec-test-coverage-ignore: preload that puts the mirror shadow check into worker threads; it asserts nothing itself
// Run with NODE_OPTIONS="--require <this file>" and MIRROR_SHADOW_LOG set: a
// worker thread installs the check as soon as it has loaded the mirror.
const { isMainThread } = require("node:worker_threads");

if (!isMainThread && process.env.MIRROR_SHADOW_LOG) {
    const timer = setInterval(() => {
        const loaded = Object.keys(require.cache).some((file) =>
            /rpcNodes[\\/]mirror[\\/]Mirror\.[jt]s$/.test(file)
        );
        if (!loaded) return;
        clearInterval(timer);
        const nodeUrl =
            process.env.MIRROR_SHADOW_NODE_URL ||
            process.env.PROVIDER_URL ||
            process.env.HARDHAT_NODE_URL;
        require("./MirrorShadowCheck").installMirrorShadowCheck(
            nodeUrl,
            process.env.MIRROR_SHADOW_LOG
        );
    }, 5);
    timer.unref();
}

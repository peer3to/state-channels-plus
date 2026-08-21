const net = require("net");

const DEFAULT_DENIED_CIDRS = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "224.0.0.0/4",
    "::1/128",
    "fc00::/7",
    "fe80::/10"
];

function hostInterfaceCidrs(interfaces) {
    const output = [];
    for (const entries of Object.values(interfaces || {})) {
        for (const entry of entries || []) {
            if (entry.family === "IPv4") output.push(`${entry.address}/32`);
            else if (entry.family === "IPv6") {
                output.push(`${entry.address.split("%")[0]}/128`);
            }
        }
    }
    return [...new Set(output)];
}

function validateCidr(cidr) {
    if (typeof cidr !== "string") {
        throw new Error(`Invalid denied CIDR: ${cidr}`);
    }
    const [address, rawPrefix, extra] = cidr.split("/");
    const family = net.isIP(address);
    const prefix = Number(rawPrefix);
    if (
        extra !== undefined ||
        !family ||
        !Number.isInteger(prefix) ||
        prefix < 0 ||
        prefix > (family === 4 ? 32 : 128)
    ) {
        throw new Error(`Invalid denied CIDR: ${cidr}`);
    }
    return cidr;
}

function isolationCapability(platform = process.platform) {
    if (platform === "linux") {
        return {
            backend: "docker",
            kernelIsolation: "shared-host-kernel",
            filesystem: "identity-volume",
            network: "host-enforced-public-egress-only",
            hardenedSharedWorker: true
        };
    }
    return {
        backend: "docker",
        kernelIsolation: "docker-desktop-shared-kernel",
        filesystem: "identity-volume",
        network: "docker-desktop-reduced-guarantee",
        hardenedSharedWorker: false
    };
}

function buildLinuxEgressRules(
    bridgeInterface,
    containerAddress,
    extraCidrs = [],
    chain = "PEER3_ISOLATED"
) {
    if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(bridgeInterface)) {
        throw new Error("Invalid bridge interface");
    }
    if (!/^[0-9a-f:.]+$/i.test(containerAddress)) {
        throw new Error("Invalid container address");
    }
    if (!/^[A-Z0-9_]{1,28}$/.test(chain)) {
        throw new Error("Invalid firewall chain");
    }
    const denied = [...new Set([...DEFAULT_DENIED_CIDRS, ...extraCidrs])]
        .map(validateCidr)
        .filter(
            (cidr) => cidr.includes(":") === containerAddress.includes(":")
        );
    return [
        ["-N", chain],
        [
            "-I",
            "DOCKER-USER",
            "1",
            "-i",
            bridgeInterface,
            "-s",
            containerAddress,
            "-j",
            chain
        ],
        [
            "-A",
            chain,
            "-m",
            "conntrack",
            "--ctstate",
            "ESTABLISHED,RELATED",
            "-j",
            "ACCEPT"
        ],
        ...denied.map((cidr) => ["-A", chain, "-d", cidr, "-j", "REJECT"]),
        ["-A", chain, "-j", "ACCEPT"]
    ];
}

module.exports = {
    DEFAULT_DENIED_CIDRS,
    buildLinuxEgressRules,
    hostInterfaceCidrs,
    isolationCapability,
    validateCidr
};

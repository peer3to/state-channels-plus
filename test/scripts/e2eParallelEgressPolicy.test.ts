// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";

const {
    buildLinuxEgressRules,
    hostInterfaceCidrs,
    isolationCapability
} = require("../../scripts/e2e-parallel/distributed/egressPolicy.js");
const {
    parseServerArgs
} = require("../../scripts/e2e-parallel/distributed/serverArgParser.js");

describe("distributed isolated egress policy", function () {
    it("derives exact deny routes for every worker-host interface", function () {
        expect(
            hostInterfaceCidrs({
                eth0: [
                    { family: "IPv4", address: "198.51.100.7" },
                    { family: "IPv6", address: "2001:db8::7" }
                ]
            })
        ).to.deep.equal(["198.51.100.7/32", "2001:db8::7/128"]);
    });

    it("denies host, link-local, private, and operator configured ranges on Linux", function () {
        const rules = buildLinuxEgressRules("peer3br0", "172.30.0.2", [
            "203.0.113.0/24"
        ]);
        const rendered = rules
            .map((rule: string[]) => rule.join(" "))
            .join("\n");
        expect(rendered).to.include("127.0.0.0/8 -j REJECT");
        expect(rendered).to.include("169.254.0.0/16 -j REJECT");
        expect(rendered).to.include("10.0.0.0/8 -j REJECT");
        expect(rendered).to.include("203.0.113.0/24 -j REJECT");
        expect(rendered).to.include("ESTABLISHED,RELATED -j ACCEPT");
        expect(rules[rules.length - 1]).to.include("ACCEPT");
        expect(() =>
            buildLinuxEgressRules("peer3br0", "172.30.0.2", ["192.0.2.1/128"])
        ).to.throw("Invalid denied CIDR");
    });

    it("reports the full Linux shared-worker guarantee without claiming a separate kernel", function () {
        const capability = isolationCapability("linux");
        expect(capability.hardenedSharedWorker).to.equal(true);
        expect(capability.kernelIsolation).to.equal("shared-host-kernel");
        expect(capability.network).to.equal("host-enforced-public-egress-only");
    });

    it("reports Docker Desktop's reduced network guarantee", function () {
        const capability = isolationCapability("darwin");
        expect(capability.hardenedSharedWorker).to.equal(false);
        expect(capability.network).to.equal("docker-desktop-reduced-guarantee");
    });

    it("rejects an invalid private-network deny range at worker startup", function () {
        expect(() =>
            parseServerArgs(
                [
                    "node",
                    "server",
                    "--name",
                    "worker-a",
                    "--deny-private-cidr",
                    "192.0.2.1/128"
                ],
                {}
            )
        ).to.throw("Invalid denied CIDR");
    });
});

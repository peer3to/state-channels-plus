import { expect } from "chai";
import { describe, it } from "mocha";
import { deriveLobbyTopic, LOBBY_TOPIC_PREFIX } from "@/discovery/lobbyTopic";

const BASE = {
    chainId: 1,
    stateChannelManagerAddress: "0x1111111111111111111111111111111111111111",
    appNamespace: "app-a",
    version: 1
};

describe("deriveLobbyTopic", () => {
    it("has the expected prefix constant", () => {
        expect(LOBBY_TOPIC_PREFIX).to.equal("peer3:lobby");
    });

    // Frozen test vectors: derivation is
    // keccak256(abi.encode(["string","uint256","address","string","uint16"],
    //   ["peer3:lobby", chainId, stateChannelManagerAddress, appNamespace, version]))
    // Changing any of these expected hashes is a deliberate lobby-topic
    // network cutover — every existing peer would land on a different DHT
    // topic and stop finding each other.
    it("matches the frozen base vector", () => {
        const topic = deriveLobbyTopic(BASE);
        expect(topic.toString("hex")).to.equal(
            "76509c7dcd1e774a17b760b1952dd1de9b989b89511f9b7a6a06abe52d8bee0b"
        );
    });

    it("matches the frozen vector with chainId varied", () => {
        const topic = deriveLobbyTopic({ ...BASE, chainId: 2 });
        expect(topic.toString("hex")).to.equal(
            "ef0f1579e32b317609fa749ada0d8c479bac9fcbce199f93036afeb1e3b4c5fa"
        );
    });

    it("matches the frozen vector with stateChannelManagerAddress varied", () => {
        const topic = deriveLobbyTopic({
            ...BASE,
            stateChannelManagerAddress:
                "0x2222222222222222222222222222222222222222"
        });
        expect(topic.toString("hex")).to.equal(
            "1a597dcc9cb70c70161bbcc4a0db8d982db8227970e3fea41afd5bd1aec99e03"
        );
    });

    it("matches the frozen vector with appNamespace varied", () => {
        const topic = deriveLobbyTopic({ ...BASE, appNamespace: "app-b" });
        expect(topic.toString("hex")).to.equal(
            "12e76540d86673119720cc3f90f5d020be735111156e0fffd6746b971232fa8a"
        );
    });

    it("matches the frozen vector with version varied", () => {
        const topic = deriveLobbyTopic({ ...BASE, version: 2 });
        expect(topic.toString("hex")).to.equal(
            "35eaa1f1c88a5c3d03748e59a2d755f3e81ea0e1b5c0e42fa4dcc4de6558546d"
        );
    });

    it("varying chainId alone yields a different topic than the base vector", () => {
        const base = deriveLobbyTopic(BASE);
        const varied = deriveLobbyTopic({ ...BASE, chainId: 2 });
        expect(varied.toString("hex")).to.not.equal(base.toString("hex"));
    });

    it("varying stateChannelManagerAddress alone yields a different topic than the base vector", () => {
        const base = deriveLobbyTopic(BASE);
        const varied = deriveLobbyTopic({
            ...BASE,
            stateChannelManagerAddress:
                "0x2222222222222222222222222222222222222222"
        });
        expect(varied.toString("hex")).to.not.equal(base.toString("hex"));
    });

    it("varying appNamespace alone yields a different topic than the base vector", () => {
        const base = deriveLobbyTopic(BASE);
        const varied = deriveLobbyTopic({ ...BASE, appNamespace: "app-b" });
        expect(varied.toString("hex")).to.not.equal(base.toString("hex"));
    });

    it("varying version alone yields a different topic than the base vector", () => {
        const base = deriveLobbyTopic(BASE);
        const varied = deriveLobbyTopic({ ...BASE, version: 2 });
        expect(varied.toString("hex")).to.not.equal(base.toString("hex"));
    });

    it("checksum, lowercase and uppercase manager addresses yield the same topic", () => {
        // Mixed-case checksummed address (real EIP-55 checksum, has a-f
        // hex letters in both cases) so lowercase/uppercase are genuinely
        // different input strings, not accidental no-ops.
        const checksummedAddress = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
        const checksummed = deriveLobbyTopic({
            ...BASE,
            stateChannelManagerAddress: checksummedAddress
        });
        const lowercase = deriveLobbyTopic({
            ...BASE,
            stateChannelManagerAddress: checksummedAddress.toLowerCase()
        });
        const uppercaseInput = "0x" + checksummedAddress.slice(2).toUpperCase();
        const uppercase = deriveLobbyTopic({
            ...BASE,
            stateChannelManagerAddress: uppercaseInput
        });
        // Sanity check the inputs are genuinely different strings (mixed-case
        // hex letters), so this test actually exercises normalization.
        expect(checksummedAddress.toLowerCase()).to.not.equal(uppercaseInput);
        expect(lowercase.toString("hex")).to.equal(checksummed.toString("hex"));
        expect(uppercase.toString("hex")).to.equal(checksummed.toString("hex"));
    });

    it("returns a 32-byte Buffer suitable for swarm.join", () => {
        const topic = deriveLobbyTopic(BASE);
        expect(Buffer.isBuffer(topic)).to.equal(true);
        expect(topic.length).to.equal(32);
    });

    it("defaults version to config.LOBBY_TOPIC_VERSION when omitted", () => {
        const withDefault = deriveLobbyTopic({
            chainId: BASE.chainId,
            stateChannelManagerAddress: BASE.stateChannelManagerAddress,
            appNamespace: BASE.appNamespace
        });
        const withExplicitDefault = deriveLobbyTopic({ ...BASE, version: 1 });
        expect(withDefault.toString("hex")).to.equal(
            withExplicitDefault.toString("hex")
        );
    });
});

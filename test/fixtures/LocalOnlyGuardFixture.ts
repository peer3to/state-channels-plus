// @spec-test-coverage-ignore: real-session setup for LocalOnlyGuard component tests
import { LocalOnlyGuardE2EFixture } from "@test/fixtures/LocalOnlyGuardE2EFixture";
import { waitFor } from "@test/utils/waitFor";

/**
 * Real two-peer sessions for the LocalOnlyGuard component cases. Peer 0 is
 * the receiver that runs the guarded services; peer 1 is the remote caller.
 */
export class LocalOnlyGuardFixture extends LocalOnlyGuardE2EFixture {
    /** Both peers completed the handshake on the opened channel's topic. */
    public async setupConnected(): Promise<void> {
        await this.startPeers();
        await this.harness.network.connectPeers([0, 1]);
        await this.harness.network.waitForP2PConnections();
    }

    /**
     * The receiver holds its own handshake initiation, so the caller's
     * address is never proven there, while the caller's handshake runs up to
     * its acknowledgement. The receiver's transport is then a real
     * negotiating transport with its registered pre-handshake profile, and
     * the caller keeps the transport it initiated over.
     */
    public async setupNegotiating(): Promise<void> {
        await this.startPeers();
        const [receiver, caller] = this.harness.peers;
        await this.control(receiver).stub.holdInitHandshakes().request();
        await this.control(caller)
            .stub.stubCaptureInitHandshakeTransport()
            .request();
        await this.harness.network.connectPeers([0, 1]);
        await this.waitForCapturedHandshakeTransport(caller);
        await waitFor(
            async () =>
                (await this.control(receiver)
                    .stub.getAckedHeldHandshakeCount()
                    .request()) > 0,
            this.harness.event.protocolEventTimeoutMs()
        );
    }

    /** The caller sends a local-only request over its pre-handshake transport. */
    public sendBeforeHandshake(value: string): Promise<string> {
        return this.control(this.harness.peers[1])
            .localOnlyGuardProbe.sendOverCapturedHandshakeTransport(
                value,
                this.harness.event.protocolEventTimeoutMs()
            )
            .request();
    }

    private async startPeers(): Promise<void> {
        await this.harness.lifecycle.start(2, 0, {
            autoConnect: false,
            customRpcManifest: this.customRpcManifest(),
            timeConfig: this.timeConfig()
        });
    }
}

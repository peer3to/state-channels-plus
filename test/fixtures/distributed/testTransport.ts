import net from "net";

export async function createSocketPair(): Promise<{
    client: net.Socket;
    server: net.Socket;
    close: () => Promise<void>;
}> {
    const listener = net.createServer();
    await new Promise<void>((resolve) =>
        listener.listen(0, "127.0.0.1", resolve)
    );
    const address = listener.address();
    if (!address || typeof address === "string")
        throw new Error("Missing TCP fixture address");
    const accepted = new Promise<net.Socket>((resolve) =>
        listener.once("connection", resolve)
    );
    const client = net.connect(address.port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
    });
    const server = await accepted;
    return {
        client,
        server,
        close: async () => {
            client.destroy();
            server.destroy();
            await new Promise<void>((resolve) =>
                listener.close(() => resolve())
            );
        }
    };
}

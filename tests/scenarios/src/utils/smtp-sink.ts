import { createServer, type Socket } from "node:net";

export async function startSmtpSink() {
	const received: { to: string; at: number }[] = [];
	const sockets = new Set<Socket>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const server = createServer((socket) => {
		let buffer = "";
		let inData = false;
		let recipient = "";

		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => {});
		socket.write("220 sink\r\n");
		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();

			while (true) {
				if (inData) {
					const end = buffer.indexOf("\r\n.\r\n");
					if (end === -1) return;

					buffer = buffer.slice(end + 5);
					inData = false;
					const to = recipient;
					const timer = setTimeout(() => {
						timers.delete(timer);
						received.push({ to, at: Date.now() });
						socket.write("250 queued\r\n");
					}, 2000);

					timers.add(timer);

					continue;
				}

				const lineEnd = buffer.indexOf("\r\n");
				if (lineEnd === -1) return;

				const line = buffer.slice(0, lineEnd);
				buffer = buffer.slice(lineEnd + 2);
				const verb = line.split(" ")[0]?.toUpperCase();
				if (verb === "RCPT") {
					recipient = line.match(/<([^>]+)>/)?.[1] ?? "";
					socket.write("250 ok\r\n");
				} else if (verb === "DATA") {
					inData = true;
					socket.write("354 go\r\n");
				} else if (verb === "QUIT") socket.end("221 bye\r\n");
				else socket.write("250 ok\r\n");
			}
		});
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("Missing SMTP Address: sink did not bind a TCP port");

	return {
		url: `smtp://127.0.0.1:${address.port}`,
		received,
		async close() {
			for (const timer of timers) clearTimeout(timer);
			for (const socket of sockets) socket.destroy();

			await new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => {
					if (error !== undefined) rejectClose(error);
					else resolveClose();
				});
			});
		},
	};
}

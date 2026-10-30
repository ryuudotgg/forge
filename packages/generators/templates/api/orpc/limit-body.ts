const maxBodySize = 1024 * 1024;

// Node 26 emits "data" from a stream pump outside oRPC's handler, so a throw here crashes the process. Emitting "error" fails the body read, which oRPC answers with a 413.
async function limitBody<T>(
  raw: Readable & { readonly headers: { "content-length"?: string } },
  next: () => Promise<T>,
) {
  const declared = Number(raw.headers["content-length"]);
  const emit = raw.emit;
  let received = 0;
  let rejected = false;

  raw.emit = (event: string | symbol, ...args: unknown[]) => {
    const [chunk] = args;
    if (event === "data" && chunk instanceof Uint8Array) {
      received += chunk.length;
      if (declared > maxBodySize || received > maxBodySize) {
        if (!rejected)
          emit.call(raw, "error", new ORPCError("PAYLOAD_TOO_LARGE"));

        rejected = true;
        return false;
      }
    }

    return emit.call(raw, event, ...args);
  };

  try {
    return await next();
  } finally {
    raw.emit = emit;
  }
}

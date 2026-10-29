import net from "node:net";

const PROBE_TIMEOUT_MS = 1_000;

// A connection attempt rather than a bind: it also sees a server listening on every interface or on another address family.
export function isPortInUse(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  // Not a usable port, so nothing can be using it; whoever starts a server there reports the bad value.
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (inUse: boolean): void => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

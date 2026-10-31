// The tail of a run that is still recording is a WebSocket (`tailEvents` in lib/api.ts). The static site holds finished
// runs only, so the app never asks for one; if it ever does, the socket closes at once and the store takes that for "the
// stream ended" (as it does for a server that went away), instead of the browser logging a failed handshake against a
// server that is not there.

type Handler = ((event: Event) => void) | null;

/** What `tailEvents` uses of a WebSocket, already closed. */
class ClosedSocket {
  readonly readyState = 3;
  onopen: Handler = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: Handler = null;
  onclose: Handler = null;

  constructor(readonly url: string) {
    // After the caller has set `onclose`, which it does in the statement that follows `new WebSocket(...)`.
    setTimeout(() => this.onclose?.(new Event("close")), 0);
  }

  close(): void {}

  send(): void {
    throw new Error("the static showcase has no live stream to send to");
  }

  addEventListener(): void {}

  removeEventListener(): void {}
}

/** Make a WebSocket to this site's `api/` close at once. Any other socket is the browser's own. */
export function silenceEventStreams(base: string | URL, target: { WebSocket: typeof WebSocket }): void {
  const apiBase = new URL("api/", base);
  target.WebSocket = new Proxy(target.WebSocket, {
    construct(real, args: ConstructorParameters<typeof WebSocket>, newTarget) {
      const url = new URL(String(args[0]), base);
      const ours = url.host === apiBase.host && url.pathname.startsWith(apiBase.pathname);
      return ours ? (new ClosedSocket(url.href) as unknown as object) : Reflect.construct(real, args, newTarget);
    },
  });
}

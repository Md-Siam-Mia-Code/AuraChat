export class UserSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = [];
    this.userId = null;
    // this.state.blockUntilReady(); // This line was removed
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/websocket")) {
      if (!this.userId) {
        this.userId = url.searchParams.get("userId");
      }

      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      this.sockets.push(server);

      server.addEventListener("close", () => this.handleDisconnect(server));
      server.addEventListener("error", () => this.handleDisconnect(server));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/broadcast")) {
      const message = await request.text();
      this.sockets.forEach((socket) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      });
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }

  handleDisconnect(socket) {
    this.sockets = this.sockets.filter((s) => s !== socket);
    if (this.sockets.length === 0 && this.userId) {
      const now = new Date().toISOString();
      // Use waitUntil to ensure this background task completes
      this.state.waitUntil(
        this.env.DB.prepare(
          "UPDATE users SET last_active_ts = ?1 WHERE id = ?2"
        )
          .bind(now, this.userId)
          .run()
      );
    }
  }
}

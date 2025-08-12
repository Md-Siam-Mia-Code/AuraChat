// src/user-session.js
import {
  getConversationParticipants,
  getConversationPartnersForUser,
} from "./db.js";

export class UserSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = [];
    this.userId = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/websocket")) {
      const isFirstConnection = this.sockets.length === 0;

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

      if (isFirstConnection && this.userId) {
        this.state.waitUntil(this.broadcastStatus("online"));
      }

      server.addEventListener("message", (event) =>
        this.handleWebSocketMessage(event)
      );
      server.addEventListener("close", () => this.handleDisconnect(server));
      server.addEventListener("error", () => this.handleDisconnect(server));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/broadcast")) {
      const message = await request.text();
      this.broadcast(message);
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }

  async handleWebSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "typing_start":
        case "typing_stop":
          this.state.waitUntil(this.handleTypingEvent(data));
          break;
        case "ping":
          break;
      }
    } catch (e) {
      console.error("Error handling WebSocket message in DO:", e);
    }
  }

  async handleTypingEvent(data) {
    const { conversationId } = data.payload;
    if (!conversationId) return;

    const participants = await getConversationParticipants(
      this.env.DB,
      conversationId,
      parseInt(this.userId, 10)
    );

    if (participants.length > 0) {
      const partnerId = participants[0];
      const message = {
        type: "typing_indicator",
        payload: {
          conversationId: conversationId,
          userId: parseInt(this.userId, 10),
          status: data.type === "typing_start" ? "start" : "stop",
        },
      };

      const durableId = this.env.USER_SESSIONS.idFromName(partnerId.toString());
      const stub = this.env.USER_SESSIONS.get(durableId);
      await stub.fetch("https://aurachat-internal/broadcast", {
        method: "POST",
        body: JSON.stringify(message),
      });
    }
  }

  async broadcastStatus(status, timestamp = new Date().toISOString()) {
    if (!this.userId) return;

    const partners = await getConversationPartnersForUser(
      this.env.DB,
      this.userId
    );
    if (partners.length === 0) return;

    const message = {
      type: "user_status_update",
      payload: {
        userId: parseInt(this.userId, 10),
        status: status,
        last_active_ts: timestamp,
      },
    };

    const broadcastUrl = "https://aurachat-internal/broadcast";
    const stubs = partners.map((id) =>
      this.env.USER_SESSIONS.get(
        this.env.USER_SESSIONS.idFromName(id.toString())
      )
    );

    const promises = stubs.map((stub) =>
      stub.fetch(broadcastUrl, {
        method: "POST",
        body: JSON.stringify(message),
      })
    );
    await Promise.all(promises);
  }

  broadcast(message) {
    this.sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    });
  }

  async handleDisconnect(socket) {
    this.sockets = this.sockets.filter((s) => s !== socket);
    if (this.sockets.length === 0 && this.userId) {
      const now = new Date().toISOString();

      // This is the corrected block.
      // We create an async function to perform the work and pass its
      // execution to waitUntil. This ensures the entire sequence completes.
      const shutdownTask = async () => {
        await this.env.DB.prepare(
          "UPDATE users SET last_active_ts = ?1 WHERE id = ?2"
        )
          .bind(now, this.userId)
          .run();
        await this.broadcastStatus("offline", now);
      };

      this.state.waitUntil(shutdownTask());
    }
  }
}

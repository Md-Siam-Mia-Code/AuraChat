// src/router.js
import {
  getConversationParticipants,
  getConversationPartnersForUser,
} from "./db.js";

export class RouterDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Map<userId, Array<WebSocket>>
    this.sessions = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/websocket")) {
      const userId = parseInt(url.searchParams.get("userId"), 10);
      if (!userId) return new Response("User details missing", { status: 400 });

      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      server.accept();

      const userSessions = this.sessions.get(userId) || [];
      const isFirstConnectionForUser = userSessions.length === 0;
      userSessions.push(server);
      this.sessions.set(userId, userSessions);

      if (isFirstConnectionForUser) {
        this.state.waitUntil(this.broadcastStatus(userId, "online"));
      }

      server.addEventListener("message", (event) =>
        this.handleWebSocketMessage(userId, event)
      );
      const closeOrErrorHandler = () => this.handleDisconnect(userId, server);
      server.addEventListener("close", closeOrErrorHandler);
      server.addEventListener("error", closeOrErrorHandler);

      return new Response(null, { status: 101, webSocket: client });
    } else if (url.pathname.endsWith("/broadcast")) {
      const { recipients, message } = await request.json();
      this.broadcast(recipients, message);
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }

  async handleWebSocketMessage(userId, event) {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "ping":
          break;
        case "typing_start":
        case "typing_stop":
          this.state.waitUntil(this.handleTypingEvent(userId, data));
          break;
      }
    } catch (err) {
      console.error("Error handling websocket message in Router DO: ", err);
    }
  }

  async handleTypingEvent(senderId, data) {
    const { conversationId } = data.payload;
    if (!conversationId) return;

    const participants = await getConversationParticipants(
      this.env.DB,
      conversationId,
      senderId
    );
    if (participants.length > 0) {
      const partnerId = participants[0];
      const message = {
        type: "typing_indicator",
        payload: {
          conversationId,
          userId: senderId,
          status: data.type === "typing_start" ? "start" : "stop",
        },
      };
      this.broadcast([partnerId], message);
    }
  }

  async handleDisconnect(userId, socket) {
    let userSessions = this.sessions.get(userId) || [];
    userSessions = userSessions.filter((s) => s !== socket);

    if (userSessions.length > 0) {
      this.sessions.set(userId, userSessions);
    } else {
      this.sessions.delete(userId);
      this.state.waitUntil(
        this.broadcastStatus(userId, "offline", new Date().toISOString())
      );
    }
  }

  async broadcastStatus(userId, status, timestamp = new Date().toISOString()) {
    const partners = await getConversationPartnersForUser(this.env.DB, userId);
    if (partners.length > 0) {
      const message = {
        type: "user_status_update",
        payload: { userId, status, last_active_ts: timestamp },
      };
      this.broadcast(partners, message);
    }
  }

  broadcast(recipients, message) {
    if (!recipients || recipients.length === 0) return;

    const serializedMessage = JSON.stringify(message);

    for (const userId of recipients) {
      const userSessions = this.sessions.get(userId);
      if (userSessions) {
        userSessions.forEach((ws) => {
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(serializedMessage);
            }
          } catch (err) {
            console.error(`Failed to send to user ${userId}: `, err);
          }
        });
      }
    }
  }
}

// src/websocket.js

import { verifyJwtToken } from "./auth.js";
import { getConversationParticipants } from "./db.js";

// This state is held in memory for the lifetime of the worker instance.
const wsConnections = new Map(); // Map<userId, Set<WebSocket>>

function broadcastToUser(userId, message) {
  const userConnections = wsConnections.get(userId);
  if (userConnections) {
    const messageString = JSON.stringify(message);
    userConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageString);
      }
    });
  }
}

function broadcastUserStatus(
  updatedUserId,
  isOnline,
  timestamp,
  skipUserId = null
) {
  const message = JSON.stringify({
    type: isOnline ? "user_online" : "user_offline",
    userId: updatedUserId,
    timestamp: timestamp,
  });
  wsConnections.forEach((userConnectionSet, userId) => {
    if (userId !== updatedUserId && userId !== skipUserId) {
      userConnectionSet.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  });
}

async function handleWebSocketSession(ws, env) {
  ws.accept();
  let currentUserId = null;

  ws.addEventListener("message", async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "authenticate") {
        const authPayload = await verifyJwtToken(data.token, env);
        if (authPayload) {
          currentUserId = authPayload.userId;
          if (!wsConnections.has(currentUserId)) {
            wsConnections.set(currentUserId, new Set());
          }
          wsConnections.get(currentUserId).add(ws);
          ws.send(
            JSON.stringify({ type: "authenticated", userId: currentUserId })
          );
        } else {
          ws.close(1008, "Invalid token");
        }
        return;
      }

      if (!currentUserId) return;

      switch (data.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        case "status_update":
          await env.DB.prepare(
            "UPDATE users SET last_active_ts = ?1 WHERE id = ?2"
          )
            .bind(data.timestamp, data.userId)
            .run();
          broadcastUserStatus(
            data.userId,
            data.status === "online",
            data.timestamp,
            currentUserId
          );
          break;
        case "mark_read": {
          const { conversationId, messageIds, readerId } = data;
          const batchStmts = messageIds.map((id) =>
            env.DB.prepare(
              "INSERT OR IGNORE INTO message_read_status (message_id, user_id) VALUES (?1, ?2)"
            ).bind(id, readerId)
          );
          await env.DB.batch(batchStmts);
          const participants = await getConversationParticipants(
            env.DB,
            conversationId,
            readerId
          );
          participants.forEach((pId) =>
            broadcastToUser(pId, {
              type: "message_read",
              conversationId,
              messageIds,
              readerId,
            })
          );
          break;
        }
      }
    } catch (e) {
      console.error("WS message processing error:", e);
    }
  });

  ws.addEventListener("close", () => {
    if (currentUserId && wsConnections.has(currentUserId)) {
      wsConnections.get(currentUserId).delete(ws);
      if (wsConnections.get(currentUserId).size === 0) {
        wsConnections.delete(currentUserId);
        const now = new Date().toISOString();
        env.DB.prepare("UPDATE users SET last_active_ts = ?1 WHERE id = ?2")
          .bind(now, currentUserId)
          .run();
        broadcastUserStatus(currentUserId, false, now, null);
      }
    }
  });

  ws.addEventListener("error", (err) => {
    console.error(`WS Error for user ${currentUserId}:`, err);
  });
}

export async function handleWebSocketUpgrade(request, env) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  // We don't await this, as it's a long-running session.
  // The fetch handler returns the response immediately.
  handleWebSocketSession(server, env);

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

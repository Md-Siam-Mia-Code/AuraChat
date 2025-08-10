import { WEBSOCKET_URL, WS_HEARTBEAT_INTERVAL_MS } from "./constants.js";
import {
  appState,
  setState,
  wsHeartbeatInterval,
  setWsHeartbeatInterval,
} from "./state.js";
import {
  renderConversationList,
  renderAdminUserList,
  updateChatHeader,
  updateMessageReadStatusUI,
} from "./render.js";

function handleUserOnlineStatusUpdate(userId, isOnline, timestamp) {
  let changed = false;
  const convo = appState.conversations.find((c) => c.partner_id === userId);
  if (convo) {
    convo.partner_last_active_ts = timestamp;
    changed = true;
    if (appState.currentConversationId === convo.id) updateChatHeader(convo);
  }
  const user = appState.users.find((u) => u.id === userId);
  if (user) {
    user.last_active_ts = timestamp;
    changed = true;
  }
  if (changed) {
    renderConversationList();
    if (appState.currentView === "admin") renderAdminUserList();
  }
}
function handleMessageReadStatusUpdate(conversationId, messageIds, readerId) {
  const messages = appState.messages.get(conversationId);
  if (!messages || readerId === appState.currentUser?.id) return;
  messageIds.forEach((id) => {
    const msg = messages.find((m) => m.id === id);
    if (
      msg &&
      msg.sender_id === appState.currentUser.id &&
      !msg.isReadByPartner
    ) {
      msg.isReadByPartner = true;
      const el = document.querySelector(`.message[data-message-id="${id}"]`);
      if (el) updateMessageReadStatusUI(el, true);
    }
  });
}
function startWebSocketTimers() {
  if (wsHeartbeatInterval) clearInterval(wsHeartbeatInterval);
  setWsHeartbeatInterval(
    setInterval(() => {
      if (appState.ws?.readyState === WebSocket.OPEN) {
        appState.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, WS_HEARTBEAT_INTERVAL_MS)
  );
}
function stopWebSocketTimers() {
  if (wsHeartbeatInterval) clearInterval(wsHeartbeatInterval);
  setWsHeartbeatInterval(null);
}
export function connectWebSocket() {
  if (!appState.currentUser?.token || appState.ws) return;
  const ws = new WebSocket(WEBSOCKET_URL);
  setState({ ws });
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "authenticate",
        token: appState.currentUser.token,
      })
    );
    startWebSocketTimers();
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "user_online":
        case "user_offline":
          handleUserOnlineStatusUpdate(
            data.userId,
            data.type === "user_online",
            data.timestamp
          );
          break;
        case "message_read":
          handleMessageReadStatusUpdate(
            data.conversationId,
            data.messageIds,
            data.readerId
          );
          break;
      }
    } catch (e) {
      console.error("Error processing WebSocket message:", e);
    }
  };
  ws.onerror = (error) => console.error("WebSocket error:", error);
  ws.onclose = () => {
    stopWebSocketTimers();
    setState({ ws: null });
  };
}
export function disconnectWebSocket() {
  stopWebSocketTimers();
  if (appState.ws) {
    appState.ws.close();
    setState({ ws: null });
  }
}

// public/js/websocket.js
import { appState, setState } from "./state.js";
import * as api from "./api.js";
import {
  addMessageToUI,
  renderConversationList,
  updateUserOnlineStatus,
  handleMessageUpdate,
  handleMessageDelete,
} from "./render.js";
import { renderTypingIndicator } from "./ui.js";

let ws;
let pingInterval;

function handleUserListUpdate() {
  if (appState.currentView === "admin") {
    api.fetchAdminUsers();
    api.fetchAdminStats();
  } else {
    api.fetchChatData();
  }
}

function handleIncomingMessage(message) {
  const conversationId = Number(message.conversation_id);
  renderTypingIndicator(false, conversationId);

  const newMessagesMap = new Map(appState.messages);
  const currentMessages = newMessagesMap.get(conversationId) || [];
  newMessagesMap.set(conversationId, [...currentMessages, message]);
  setState({ messages: newMessagesMap });

  if (conversationId === Number(appState.currentConversationId)) {
    addMessageToUI(message);
  }

  import("./render.js").then((m) =>
    m.updateConversationListSnippet(conversationId, message)
  );
}

export function sendTypingEvent(type) {
  if (ws?.readyState !== WebSocket.OPEN || !appState.currentConversationId)
    return;
  const event = {
    type: type === "start" ? "typing_start" : "typing_stop",
    payload: {
      conversationId: Number(appState.currentConversationId),
    },
  };
  ws.send(JSON.stringify(event));
}

export function connectWebSocket() {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  const token = appState.currentUser?.token;
  if (!token) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

  ws = new WebSocket(wsUrl);
  setState({ ws });

  ws.onopen = () => {
    console.log("AuraChat WebSocket connected.");
    clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "user_created":
        case "user_deleted":
          handleUserListUpdate();
          break;
        case "new_message":
          handleIncomingMessage(data.payload);
          break;
        case "typing_indicator":
          renderTypingIndicator(
            data.payload.status === "start",
            Number(data.payload.conversationId)
          );
          break;
        case "user_status_update":
          updateUserOnlineStatus(data.payload);
          break;
        case "message_updated":
          handleMessageUpdate(data.payload);
          break;
        case "message_deleted":
          handleMessageDelete(data.payload);
          break;
      }
    } catch (e) {
      console.error("Error processing WebSocket message:", e);
    }
  };

  ws.onclose = () => {
    console.log("AuraChat WebSocket disconnected. Reconnecting in 5s...");
    clearInterval(pingInterval);
    setState({ ws: null });
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    ws.close();
  };
}

export function disconnectWebSocket() {
  clearInterval(pingInterval);
  if (appState.ws) {
    appState.ws.onclose = null; // Prevent automatic reconnection
    appState.ws.close();
    setState({ ws: null });
  }
}

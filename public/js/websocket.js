import { appState, setState } from "./state.js";
import * as api from "./api.js";
import {
  addMessageToUI,
  renderConversationList,
  renderAdminUserList,
  updateChatHeader,
  updateConversationListSnippet,
} from "./render.js";

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
  if (message.conversation_id === appState.currentConversationId) {
    addMessageToUI(message);
  }
  updateConversationListSnippet(message.conversation_id, message);
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
          handleIncomingMessage(data.message);
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

// public/js/view.js
import { dom } from "./dom.js";
import { appState, setState } from "./state.js";
import { SESSION_STORAGE_KEY } from "./constants.js";
import { showElement, hideElement, showError } from "./ui.js";
import { isMobileView, escapeHtml } from "./utils.js";
import {
  checkSetupStatus,
  fetchChatData,
  fetchAdminStats,
  fetchAdminUsers,
} from "./api.js";
import { connectWebSocket } from "./websocket.js";
import { updateChatHeader } from "./render.js";

const screens = {
  loading: dom.loadingScreen,
  onboarding: dom.onboardingScreen,
  login: dom.loginScreen,
  chat: dom.chatApp,
  admin: dom.adminDashboard,
};

export function switchView(newView) {
  if (appState.currentView === newView) return;

  Object.values(screens).forEach((screen) => screen && hideElement(screen));

  const newScreen = screens[newView];
  if (newScreen) {
    showElement(newScreen);
  } else {
    console.error(`Error: Cannot switch to unknown view '${newView}'.`);
  }

  setState({ currentView: newView });
}

export function handleApiError(error) {
  if (
    error.status === 401 &&
    appState.currentView !== "login" &&
    appState.currentView !== "onboarding"
  ) {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    window.location.reload();
  } else {
    showError(error.message || "An unexpected error occurred.");
  }
}

export function selectConversation(conversationId) {
  if (appState.currentConversationId == conversationId) return;
  setState({ currentConversationId: Number(conversationId) });
  const conversation = appState.conversations.find(
    (c) => c.id == conversationId
  );
  if (conversation) {
    updateChatHeader(conversation);
    import("./api.js").then((m) =>
      m.fetchMessagesForConversation(conversationId)
    );
  }
  document
    .querySelectorAll(".conversation-item.active")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelector(
      `.conversation-item[data-conversation-id="${conversationId}"]`
    )
    ?.classList.add("active");
  if (isMobileView()) document.body.classList.remove("left-panel-active");
}

export function showUserLoginForm() {
  dom.adminLoginForm.classList.remove("active-panel");
  dom.userLoginForm.classList.add("active-panel");
  dom.adminLoginTab.classList.remove("active");
  dom.userLoginTab.classList.add("active");
}

export function showAdminLoginForm() {
  dom.userLoginForm.classList.remove("active-panel");
  dom.adminLoginForm.classList.add("active-panel");
  dom.userLoginTab.classList.remove("active");
  dom.adminLoginTab.classList.add("active");
}

export async function initializeApp() {
  switchView("loading");
  const savedSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (savedSession) {
    try {
      const user = JSON.parse(savedSession);
      if (!user.token) throw new Error("Invalid session");
      setState({ currentUser: user });
      connectWebSocket();
      if (user.isAdmin) {
        await initializeAdminDashboard();
      } else {
        await initializeChatView();
      }
      return;
    } catch (e) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }
  try {
    const { adminExists } = await checkSetupStatus();
    switchView(adminExists ? "login" : "onboarding");
  } catch (e) {
    showError("Could not connect to server. Please refresh.", 10000);
  }
}

export async function initializeChatView() {
  if (!appState.currentUser || appState.currentUser.isAdmin) {
    return initializeApp();
  }
  switchView("chat");
  dom.myUsernameSummary.textContent = escapeHtml(appState.currentUser.username);
  await fetchChatData();
  await import("./api.js").then((m) => m.fetchBlockedUsers());
}

export async function initializeAdminDashboard() {
  if (!appState.currentUser || !appState.currentUser.isAdmin) {
    return initializeApp();
  }
  switchView("admin");
  dom.adminUsernameDisplay.textContent = escapeHtml(
    appState.currentUser.username
  );
  await Promise.all([fetchAdminStats(), fetchAdminUsers()]);
}

// public/js/api.js

import {
  API_BASE_URL,
  MESSAGES_INITIAL_LOAD_LIMIT,
  MESSAGES_LOAD_OLDER_LIMIT,
} from "./constants.js";
import { appState, setState } from "./state.js";
import { dom } from "./dom.js";
import {
  handleApiError,
  initializeAdminDashboard,
  initializeChatView,
  selectConversation,
} from "./view.js";
import {
  setButtonLoading,
  setFormError,
  showConfirmation,
  showElement,
  hideElement,
  adjustTextareaHeight,
  hideEmojiPanel,
} from "./ui.js";
import {
  renderConversationList,
  renderBlockedUsersList,
  renderMessages,
  addMessageToUI,
  removeOptimisticMessage,
  updateOptimisticMessage,
  updateConversationListSnippet,
  renderAdminStats,
  renderAdminUserList,
  scrollToMessage,
} from "./render.js";
import { connectWebSocket } from "./websocket.js";
import { escapeHtml } from "./utils.js";

async function apiCall(endpoint, method = "GET", body = null) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = { "Content-Type": "application/json" };
  if (appState.currentUser?.token)
    headers["Authorization"] = `Bearer ${appState.currentUser.token}`;
  const options = { method, headers };
  if (body && method !== "GET") options.body = JSON.stringify(body);
  try {
    const response = await fetch(url, options);
    if (response.status === 204) return { success: true };
    const responseData = await response.json();
    if (!response.ok) {
      const error = new Error(
        responseData.error || `API Error ${response.status}`
      );
      error.status = response.status;
      throw error;
    }
    return responseData;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

export async function checkSetupStatus() {
  return await apiCall("/setup/status");
}

export async function fetchChatData() {
  setState({
    isLoading: { ...appState.isLoading, conversations: true, users: true },
  });
  renderConversationList();
  try {
    const [convos, users] = await Promise.all([
      apiCall("/conversations"),
      apiCall("/users"),
    ]);
    setState({ conversations: convos || [], users: users || [] });
  } finally {
    setState({
      isLoading: { ...appState.isLoading, conversations: false, users: false },
    });
    renderConversationList();
  }
}

export async function fetchBlockedUsers() {
  setState({ isLoading: { ...appState.isLoading, blockedUsers: true } });
  renderBlockedUsersList();
  try {
    const blocked = await apiCall("/blocks");
    setState({ blockedUsers: blocked || [] });
  } finally {
    setState({ isLoading: { ...appState.isLoading, blockedUsers: false } });
    renderBlockedUsersList();
  }
}

export async function fetchMessagesForConversation(id, isManual = false) {
  if (appState.isLoading.messages) return;
  setState({ isLoading: { ...appState.isLoading, messages: true } });
  if (isManual) setButtonLoading(dom.refreshMessagesButton, true);
  renderMessages(id);
  try {
    const messages = await apiCall(`/conversations/${id}/messages`);
    appState.messages.set(id, messages || []);
    appState.oldestMessageTimestamp.set(id, messages?.[0]?.timestamp);
    appState.hasReachedOldestMessage.set(
      id,
      (messages?.length || 0) < MESSAGES_INITIAL_LOAD_LIMIT
    );
  } catch (e) {
    appState.messages.set(id, []);
  } finally {
    setState({ isLoading: { ...appState.isLoading, messages: false } });
    renderMessages(id);
    if (isManual) setButtonLoading(dom.refreshMessagesButton, false);
  }
}

export async function fetchOlderMessages(id) {
  if (
    appState.isLoading.olderMessages ||
    appState.hasReachedOldestMessage.get(id)
  )
    return;
  setState({ isLoading: { ...appState.isLoading, olderMessages: true } });
  const beforeTs = appState.oldestMessageTimestamp.get(id);
  if (!beforeTs) {
    setState({ isLoading: { ...appState.isLoading, olderMessages: false } });
    return;
  }
  try {
    const olderMessages = await apiCall(
      `/conversations/${id}/messages?before_ts=${encodeURIComponent(beforeTs)}`
    );
    if (olderMessages?.length > 0) {
      const currentMessages = appState.messages.get(id) || [];
      appState.messages.set(id, [...olderMessages, ...currentMessages]);
      appState.oldestMessageTimestamp.set(id, olderMessages[0].timestamp);
      if (olderMessages.length < MESSAGES_LOAD_OLDER_LIMIT) {
        appState.hasReachedOldestMessage.set(id, true);
      }
      renderMessages(id);
    } else {
      appState.hasReachedOldestMessage.set(id, true);
      renderMessages(id);
    }
  } finally {
    setState({ isLoading: { ...appState.isLoading, olderMessages: false } });
  }
}

export async function fetchAdminStats() {
  setState({ isLoading: { ...appState.isLoading, adminStats: true } });
  try {
    const stats = await apiCall("/admin/stats");
    setState({ adminStats: stats });
  } finally {
    setState({ isLoading: { ...appState.isLoading, adminStats: false } });
    renderAdminStats();
  }
}

export async function fetchAdminUsers() {
  setState({ isLoading: { ...appState.isLoading, allUsersAdmin: true } });
  try {
    const users = await apiCall("/admin/users");
    setState({ adminUserList: users });
  } finally {
    setState({ isLoading: { ...appState.isLoading, allUsersAdmin: false } });
    renderAdminUserList();
  }
}

export async function handleOnboardingSubmit() {
  const username = dom.onboardingForm.username.value.trim();
  const password = dom.onboardingForm.password.value;
  const masterPassword = dom.onboardingForm.masterPassword.value;
  if (
    username.length < 3 ||
    password.length < 8 ||
    masterPassword.length < 10
  ) {
    setFormError("onboarding", "Input requirements not met.");
    return;
  }
  setButtonLoading(dom.onboardingSubmit, true);
  try {
    await apiCall("/setup/admin", "POST", {
      username,
      password,
      masterPassword,
    });
    import("./view.js").then((m) => m.switchView("login"));
  } catch (e) {
    setFormError("onboarding", e.message);
  } finally {
    setButtonLoading(dom.onboardingSubmit, false);
  }
}

export async function handleUserLoginSubmit() {
  const username = dom.userLoginForm.username.value.trim();
  const password = dom.userLoginForm.password.value;
  if (!username || !password) {
    setFormError("login", "All fields are required.");
    return;
  }
  setButtonLoading(dom.loginSubmit, true);
  try {
    const response = await apiCall("/auth/login", "POST", {
      username,
      password,
    });
    setState({ currentUser: { ...response.user, token: response.token } });
    sessionStorage.setItem(
      "connected-session-v2",
      JSON.stringify(appState.currentUser)
    );
    connectWebSocket();
    await initializeChatView();
  } catch (e) {
    setFormError("login", e.message);
  } finally {
    setButtonLoading(dom.loginSubmit, false);
  }
}

export async function handleAdminLoginSubmit() {
  const masterPassword = dom.adminLoginForm.masterPassword.value;
  if (!masterPassword) {
    setFormError("login", "Master password is required.");
    return;
  }
  setButtonLoading(dom.adminLoginSubmit, true);
  try {
    const response = await apiCall("/auth/admin/login", "POST", {
      masterPassword,
    });
    setState({ currentUser: { ...response.user, token: response.token } });
    sessionStorage.setItem(
      "connected-session-v2",
      JSON.stringify(appState.currentUser)
    );
    connectWebSocket();
    await initializeAdminDashboard();
  } catch (e) {
    setFormError("login", e.message);
  } finally {
    setButtonLoading(dom.adminLoginSubmit, false);
  }
}

export async function handleSendMessage() {
  const content = dom.messageInput.value.trim();
  if (!content) return;
  const tempId = `temp_${Date.now()}`;
  const optimisticMessage = {
    id: tempId,
    content,
    sender_id: appState.currentUser.id,
    timestamp: new Date().toISOString(),
    isOptimistic: true,
  };
  addMessageToUI(optimisticMessage);
  dom.messageInput.value = "";
  adjustTextareaHeight();
  try {
    const result = await apiCall(
      `/conversations/${appState.currentConversationId}/messages`,
      "POST",
      { content }
    );
    updateOptimisticMessage(tempId, result.message);
    updateConversationListSnippet(
      appState.currentConversationId,
      result.message
    );
  } catch (e) {
    removeOptimisticMessage(tempId);
  }
}

export async function handleStartNewConversation(userId) {
  const response = await apiCall("/conversations", "POST", {
    partnerId: Number(userId),
  });
  if (response.success && response.conversationId) {
    await fetchChatData();
    selectConversation(response.conversationId);
  }
}

export async function handleBlockUser() {
  const userId = Number(dom.blockUserButton.dataset.userId);
  const username = dom.chatPartnerName.textContent || "this user";
  if (await showConfirmation(`Block ${username}?`)) {
    await apiCall("/blocks", "POST", { userId });
    await fetchChatData();
    await fetchBlockedUsers();
  }
}

export async function handleUnblockUser(delegate) {
  const userId = Number(delegate.dataset.userId);
  setButtonLoading(delegate, true);
  await apiCall(`/blocks/${userId}`, "DELETE");
  await fetchBlockedUsers();
  await fetchChatData();
}

export async function handleAdminAddUserSubmit() {
  const username = dom.adminAddUserForm.username.value.trim();
  const password = dom.adminAddUserForm.password.value;
  if (username.length < 3 || password.length < 8) {
    setFormError("adminUser", "Username/Password requirements not met.");
    return;
  }
  setButtonLoading(dom.adminAddUserButton, true);
  try {
    await apiCall("/admin/users", "POST", { username, password });
    dom.adminAddUserForm.reset();
    await fetchAdminUsers();
  } catch (e) {
    setFormError("adminUser", e.message);
  } finally {
    setButtonLoading(dom.adminAddUserButton, false);
  }
}

export async function handleAdminDeleteUser(delegate) {
  const userId = Number(delegate.dataset.userId);
  const username = delegate.dataset.username || "this user";
  if (await showConfirmation(`Delete ${username} permanently?`)) {
    setButtonLoading(delegate, true);
    await apiCall(`/admin/users/${userId}`, "DELETE");
    await fetchAdminUsers();
  }
}

export async function handleDeleteMessage(messageId, messageElement) {
  if (await showConfirmation("Delete this message?")) {
    messageElement.style.opacity = "0.5";
    await apiCall(`/messages/${messageId}`, "DELETE");
    messageElement.remove();
  }
}

export function handleShowEditInput(messageId, messageElement) {
  cancelEdit();
  setState({ editingMessageId: messageId });
  messageElement.classList.add("editing");
  const contentSpan = messageElement.querySelector(".message-content");
  const originalContent =
    appState.messages
      .get(appState.currentConversationId)
      ?.find((m) => m.id == messageId)?.content || "";

  const editContainer = document.createElement("div");
  editContainer.className = "edit-input-container";
  const editInput = document.createElement("textarea");
  editInput.className = "edit-textarea";
  editInput.value = originalContent;

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "edit-button-group";
  const saveBtn = document.createElement("button");
  saveBtn.className = "custom-button button-confirm";
  saveBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "custom-button button-cancel";
  cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

  buttonGroup.append(cancelBtn, saveBtn);
  editContainer.append(editInput, buttonGroup);

  if (contentSpan) contentSpan.style.display = "none";
  messageElement.appendChild(editContainer);
  editInput.focus();

  cancelBtn.onclick = () => cancelEdit();
  saveBtn.onclick = async () => {
    const newContent = editInput.value.trim();
    if (newContent && newContent !== originalContent) {
      await apiCall(`/messages/${messageId}`, "PATCH", { content: newContent });
      if (contentSpan)
        contentSpan.innerHTML = `${escapeHtml(newContent)} <span class="edited-indicator">(edited)</span>`;
    }
    cancelEdit();
  };
}

export function cancelEdit() {
  if (!appState.editingMessageId) return;
  const el = dom.messageArea.querySelector(
    `.message.editing[data-message-id="${appState.editingMessageId}"]`
  );
  if (el) {
    el.classList.remove("editing");
    el.querySelector(".edit-input-container")?.remove();
    const contentSpan = el.querySelector(".message-content");
    if (contentSpan) contentSpan.style.display = "";
  }
  setState({ editingMessageId: null });
}

export function handleReplyToMessage(messageId) {
  const msg = appState.messages
    .get(appState.currentConversationId)
    ?.find((m) => m.id == messageId);
  if (!msg) return;
  cancelEdit();
  setState({ replyingToMessageId: messageId });
  dom.replyContextUser.textContent = escapeHtml(msg.sender_username);
  dom.replyContextText.textContent = escapeHtml(msg.content.substring(0, 100));
  showElement(dom.replyContextArea);
  dom.messageInput?.focus();
}

export function cancelReply() {
  setState({ replyingToMessageId: null });
  hideElement(dom.replyContextArea);
}

export function scrollToReply(messageId) {
  scrollToMessage(messageId);
}

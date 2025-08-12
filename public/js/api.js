// public/js/api.js
import {
  API_BASE_URL,
  MESSAGES_INITIAL_LOAD_LIMIT,
  MESSAGES_LOAD_OLDER_LIMIT,
  SESSION_STORAGE_KEY,
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
  clearChatView,
  renderMessageEditUI,
  removeMessageEditUI,
} from "./render.js";
import { connectWebSocket } from "./websocket.js";
import { escapeHtml } from "./utils.js";

async function apiCall(endpoint, method = "GET", body = null) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = { "Content-Type": "application/json" };
  if (appState.currentUser?.token) {
    headers["Authorization"] = `Bearer ${appState.currentUser.token}`;
  }
  const options = { method, headers };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }
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
  return apiCall("/setup/status");
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
  const numId = Number(id);
  setState({ isLoading: { ...appState.isLoading, messages: true } });
  if (isManual) setButtonLoading(dom.refreshMessagesButton, true);
  renderMessages(id);
  try {
    const messages = await apiCall(`/conversations/${numId}/messages`);
    const newMessagesMap = new Map(appState.messages);
    newMessagesMap.set(numId, messages || []);
    setState({ messages: newMessagesMap });

    appState.oldestMessageTimestamp.set(numId, messages?.[0]?.timestamp);
    appState.hasReachedOldestMessage.set(
      numId,
      (messages?.length || 0) < MESSAGES_INITIAL_LOAD_LIMIT
    );
  } catch (e) {
    const newMessagesMap = new Map(appState.messages);
    newMessagesMap.set(numId, []);
    setState({ messages: newMessagesMap });
  } finally {
    setState({ isLoading: { ...appState.isLoading, messages: false } });
    renderMessages(id);
    if (isManual) setButtonLoading(dom.refreshMessagesButton, false);
  }
}

export async function fetchOlderMessages(id) {
  const numId = Number(id);
  if (
    appState.isLoading.olderMessages ||
    appState.hasReachedOldestMessage.get(numId)
  )
    return;
  setState({ isLoading: { ...appState.isLoading, olderMessages: true } });
  const beforeTs = appState.oldestMessageTimestamp.get(numId);
  if (!beforeTs) {
    setState({ isLoading: { ...appState.isLoading, olderMessages: false } });
    return;
  }
  try {
    const olderMessages = await apiCall(
      `/conversations/${numId}/messages?before_ts=${encodeURIComponent(beforeTs)}`
    );
    if (olderMessages?.length > 0) {
      const newMessagesMap = new Map(appState.messages);
      const currentMessages = newMessagesMap.get(numId) || [];
      newMessagesMap.set(numId, [...olderMessages, ...currentMessages]);
      setState({ messages: newMessagesMap });

      appState.oldestMessageTimestamp.set(numId, olderMessages[0].timestamp);
      if (olderMessages.length < MESSAGES_LOAD_OLDER_LIMIT) {
        appState.hasReachedOldestMessage.set(numId, true);
      }
      renderMessages(id, { keepScrollPosition: true });
    } else {
      appState.hasReachedOldestMessage.set(numId, true);
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
      SESSION_STORAGE_KEY,
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
      SESSION_STORAGE_KEY,
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
  const { replyingToMessageId, currentConversationId } = appState;
  const numConversationId = Number(currentConversationId);
  const tempId = `temp_${Date.now()}`;

  const optimisticMessage = {
    id: tempId,
    content,
    sender_id: appState.currentUser.id,
    timestamp: new Date().toISOString(),
    isOptimistic: true,
    reply_to_message_id: replyingToMessageId,
  };
  if (replyingToMessageId) {
    const original = (appState.messages.get(numConversationId) || []).find(
      (m) => String(m.id) === String(replyingToMessageId)
    );
    if (original) {
      optimisticMessage.reply_sender_username = original.sender_username;
      optimisticMessage.reply_snippet = original.content;
    }
  }

  const newMessagesMap = new Map(appState.messages);
  const currentMessages = newMessagesMap.get(numConversationId) || [];
  newMessagesMap.set(numConversationId, [
    ...currentMessages,
    optimisticMessage,
  ]);
  setState({ messages: newMessagesMap });

  addMessageToUI(optimisticMessage);
  cancelReply();
  dom.messageInput.value = "";
  adjustTextareaHeight();

  try {
    const result = await apiCall(
      `/conversations/${numConversationId}/messages`,
      "POST",
      { content, reply_to_message_id: replyingToMessageId }
    );

    const finalMessagesMap = new Map(appState.messages);
    const messages = finalMessagesMap.get(numConversationId) || [];
    const newMessages = messages.map((m) =>
      m.id === tempId ? result.message : m
    );
    finalMessagesMap.set(numConversationId, newMessages);
    setState({ messages: finalMessagesMap });

    updateOptimisticMessage(tempId, result.message);
    updateConversationListSnippet(currentConversationId, result.message);
  } catch (e) {
    const finalMessagesMap = new Map(appState.messages);
    const messages = finalMessagesMap.get(numConversationId) || [];
    finalMessagesMap.set(
      numConversationId,
      messages.filter((m) => m.id !== tempId)
    );
    setState({ messages: finalMessagesMap });
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
    clearChatView();
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
    setFormError("adminUser", "");
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
  if (await showConfirmation("Delete this message permanently?")) {
    messageElement.style.opacity = "0.5";
    try {
      await apiCall(`/messages/${messageId}`, "DELETE");
    } catch (e) {
      messageElement.style.opacity = "1";
    }
  }
}

export async function handleEditMessage(messageId, newContent, onFinish) {
  try {
    await apiCall(`/messages/${messageId}`, "PATCH", { content: newContent });
  } finally {
    if (onFinish) onFinish();
  }
}

export function startEditingMessage(messageId, messageElement) {
  if (appState.editingMessageId) {
    cancelEdit();
  }
  setState({ editingMessageId: messageId });
  renderMessageEditUI(messageElement);
}

export function cancelEdit() {
  if (appState.editingMessageId) {
    const el = document.querySelector(
      `[data-message-id="${appState.editingMessageId}"]`
    );
    if (el) removeMessageEditUI(el);
  }
  setState({ editingMessageId: null });
}

export function handleReplyToMessage(messageId) {
  const numConversationId = Number(appState.currentConversationId);
  const currentMessages = appState.messages.get(numConversationId) || [];

  const messageToReply = currentMessages.find(
    (m) => String(m.id) === String(messageId)
  );

  if (!messageToReply) {
    console.error("Could not find message to reply to with ID:", messageId);
    return;
  }

  setState({ replyingToMessageId: messageToReply.id });
  dom.replyContextUser.textContent = escapeHtml(messageToReply.sender_username);
  dom.replyContextText.textContent = escapeHtml(messageToReply.content);
  showElement(dom.replyContextArea);
  dom.messageInput.focus();
}

export function cancelReply() {
  setState({ replyingToMessageId: null });
  hideElement(dom.replyContextArea);
}

export function scrollToReply(messageId) {
  scrollToMessage(messageId);
}

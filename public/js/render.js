// public/js/render.js
import { dom } from "./dom.js";
import { appState, setState } from "./state.js";
import {
  escapeHtml,
  formatDate,
  formatLastSeen,
  formatTimeGap,
} from "./utils.js";
import {
  ONLINE_THRESHOLD_MINUTES,
  EMOJI_REGEX_CHECK,
  TIME_GAP_THRESHOLD_MINUTES,
  MANUAL_BUTTON_SCROLL_THRESHOLD,
} from "./constants.js";
import { showElement, hideElement, scrollToBottom } from "./ui.js";
import * as api from "./api.js";

function createMessageHTML(msg) {
  const isMyMessage = msg.sender_id === appState.currentUser.id;
  const isEmojiOnly = msg.content && EMOJI_REGEX_CHECK.test(msg.content);
  const idAttr = msg.isOptimistic ? `id="${msg.id}"` : "";
  let replyHTML = "";

  if (msg.reply_to_message_id) {
    const originalSender = escapeHtml(msg.reply_sender_username || "User");
    const snippetText = escapeHtml(msg.reply_snippet || "Original message");
    replyHTML = `<div class="reply-snippet" data-action="scroll-to-reply" data-reply-to-id="${msg.reply_to_message_id}"><strong>${originalSender}</strong><span>${snippetText}</span></div>`;
  }

  return `
    <div class="message ${isMyMessage ? "sent" : "received"} ${isEmojiOnly ? "message-emoji-only" : ""}" ${idAttr} data-message-id="${msg.id}">
        <div class="message-swipe-indicator"><i class="fa-solid fa-reply"></i></div>
        <div class="message-content-wrapper">
            ${replyHTML}
            <div class="message-content">${escapeHtml(msg.content)}</div>
            <div class="message-meta">
                <span class="message-timestamp">${formatDate(msg.timestamp)}</span>
                ${msg.is_edited ? '<span class="edited-indicator">(edited)</span>' : ""}
            </div>
        </div>
        <div class="message-actions">
            <button class="message-action-button" data-action="reply-message" title="Reply"><i class="fa-solid fa-reply"></i></button>
            ${isMyMessage ? `<button class="message-action-button" data-action="edit-message" title="Edit"><i class="fa-solid fa-pencil"></i></button>` : ""}
            ${isMyMessage ? `<button class="message-action-button" data-action="delete-message" title="Delete"><i class="fa-solid fa-trash-can"></i></button>` : ""}
        </div>
    </div>`;
}

export function renderMessageEditUI(messageElement) {
  const contentDiv = messageElement.querySelector(".message-content");
  if (!contentDiv) return;

  const originalContent = contentDiv.textContent;
  contentDiv.style.display = "none";

  const form = document.createElement("form");
  form.className = "message-edit-form";
  form.innerHTML = `
        <textarea name="newContent" required>${originalContent}</textarea>
        <div class="message-edit-actions">
            <p>Press Esc to <button type="button" class="link-button" data-action="cancel-edit">cancel</button> &bull; Enter to <button type="submit" class="link-button">save</button></p>
        </div>
    `;

  const wrapper = messageElement.querySelector(".message-content-wrapper");
  wrapper.appendChild(form);
  const textarea = form.querySelector("textarea");
  textarea.focus();
  textarea.select();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const newContent = textarea.value.trim();
    if (newContent && newContent !== originalContent) {
      const messageId = messageElement.dataset.messageId;
      api.handleEditMessage(messageId, newContent, () => {
        removeMessageEditUI(messageElement);
      });
    } else {
      removeMessageEditUI(messageElement);
    }
  });
}

export function removeMessageEditUI(messageElement) {
  if (!messageElement) return;
  const form = messageElement.querySelector(".message-edit-form");
  if (form) form.remove();
  const contentDiv = messageElement.querySelector(".message-content");
  if (contentDiv) contentDiv.style.display = "block";
  setState({ editingMessageId: null });
}

export function handleMessageUpdate({
  messageId,
  conversationId,
  newContent,
  editedAt,
}) {
  const numConversationId = Number(conversationId);
  const newMessagesMap = new Map(appState.messages);
  const messages = newMessagesMap.get(numConversationId) || [];
  const newMessages = messages.map((msg) => {
    if (String(msg.id) === String(messageId)) {
      return {
        ...msg,
        content: newContent,
        is_edited: true,
        edited_at: editedAt,
      };
    }
    return msg;
  });
  newMessagesMap.set(numConversationId, newMessages);
  setState({ messages: newMessagesMap });

  if (numConversationId === Number(appState.currentConversationId)) {
    const messageElement = document.querySelector(
      `[data-message-id="${messageId}"]`
    );
    if (messageElement) {
      if (String(appState.editingMessageId) === String(messageId)) {
        removeMessageEditUI(messageElement);
      }
      messageElement.querySelector(".message-content").textContent = newContent;
      let indicator = messageElement.querySelector(".edited-indicator");
      if (!indicator) {
        indicator = document.createElement("span");
        indicator.className = "edited-indicator";
        indicator.textContent = "(edited)";
        messageElement.querySelector(".message-meta").appendChild(indicator);
      }
    }
  }
}

export function handleMessageDelete({ messageId, conversationId }) {
  const numConversationId = Number(conversationId);
  const newMessagesMap = new Map(appState.messages);
  const messages = newMessagesMap.get(numConversationId) || [];
  newMessagesMap.set(
    numConversationId,
    messages.filter((m) => String(m.id) !== String(messageId))
  );
  setState({ messages: newMessagesMap });

  if (numConversationId === Number(appState.currentConversationId)) {
    const messageElement = document.querySelector(
      `[data-message-id="${messageId}"]`
    );
    if (messageElement) {
      messageElement.style.opacity = "0";
      setTimeout(() => messageElement.remove(), 300);
    }
  }
}

export function renderConversationList() {
  if (!dom.conversationListArea || !appState.currentUser) return;
  const searchTerm = dom.conversationSearch?.value.toLowerCase() || "";

  if (appState.isLoading.conversations) {
    dom.conversationListArea.innerHTML = `<div class="list-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`;
    return;
  }

  const allItems = [...appState.conversations];
  const convoPartnerIds = new Set(
    appState.conversations.map((c) => c.partner_id)
  );

  appState.users.forEach((user) => {
    if (user.id !== appState.currentUser.id && !convoPartnerIds.has(user.id)) {
      allItems.push({ type: "user", ...user });
    }
  });

  const filteredItems = allItems.filter((item) => {
    const name = item.partner_username || item.username || "";
    return name.toLowerCase().includes(searchTerm);
  });

  if (filteredItems.length === 0) {
    dom.conversationListArea.innerHTML = `<div class="list-placeholder">${searchTerm ? "No results found." : "Start a new chat!"}</div>`;
    return;
  }

  dom.conversationListArea.innerHTML = filteredItems
    .map((item) => {
      const isOnline =
        item.last_active_ts &&
        new Date() - new Date(item.last_active_ts) <
          ONLINE_THRESHOLD_MINUTES * 60 * 1000;

      if (item.type === "user") {
        return `
          <div class="conversation-item user-list-item" data-action="startConversation" data-user-id="${item.id}">
              <div class="avatar avatar-small ${isOnline ? "online" : ""}"><i class="fa-solid fa-user"></i></div>
              <div class="conversation-details">
                  <span class="conversation-name">${escapeHtml(item.username)}</span>
                  <span class="conversation-snippet">Start a new conversation</span>
              </div>
          </div>`;
      } else {
        const partnerOnline =
          item.partner_last_active_ts &&
          new Date() - new Date(item.partner_last_active_ts) <
            ONLINE_THRESHOLD_MINUTES * 60 * 1000;
        const snippet = item.last_message_content
          ? (item.last_message_sender === appState.currentUser.username
              ? `You: `
              : "") + escapeHtml(item.last_message_content)
          : "No messages yet";

        return `
          <div class="conversation-item ${item.id == appState.currentConversationId ? "active" : ""}" data-action="selectConversation" data-conversation-id="${item.id}">
              <div class="avatar avatar-small ${partnerOnline ? "online" : ""}"><i class="fa-solid fa-user"></i></div>
              <div class="conversation-details">
                  <span class="conversation-name">${escapeHtml(item.partner_username)}</span>
                  <span class="conversation-snippet">${snippet}</span>
              </div>
              <div class="conversation-meta">
                  ${item.last_message_ts ? `<span class="conversation-timestamp">${formatDate(item.last_message_ts, true)}</span>` : ""}
                  ${item.unread_count > 0 ? `<div class="unread-indicator">${item.unread_count}</div>` : ""}
              </div>
          </div>`;
      }
    })
    .join("");
}

export function renderMessages(conversationId, options = {}) {
  const wrapper = dom.messageArea.querySelector(".messages-list-wrapper");
  if (!wrapper) return;

  const oldScrollHeight = dom.messageArea.scrollHeight;

  // FIX: Convert ID to a number to correctly fetch from the state map.
  const numId = Number(conversationId);
  const messages = appState.messages.get(numId) || [];

  if (appState.isLoading.messages && messages.length === 0) {
    wrapper.innerHTML = `<div class="list-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Loading messages...</div>`;
    return;
  }
  if (messages.length === 0) {
    wrapper.innerHTML = `<div class="list-placeholder">No messages yet. Send an aura wave!</div>`;
    return;
  }

  let messagesHtml = "";
  let lastTimestamp = null;

  messages.forEach((msg) => {
    const currentTimestamp = new Date(msg.timestamp);
    if (
      lastTimestamp &&
      currentTimestamp.getTime() - lastTimestamp.getTime() >
        TIME_GAP_THRESHOLD_MINUTES * 60 * 1000
    ) {
      messagesHtml += `<div class="message-time-gap-marker">${formatTimeGap(msg.timestamp)}</div>`;
    }
    messagesHtml += createMessageHTML(msg);
    lastTimestamp = currentTimestamp;
  });

  wrapper.innerHTML = messagesHtml;

  if (options.keepScrollPosition) {
    dom.messageArea.scrollTop = dom.messageArea.scrollHeight - oldScrollHeight;
  } else {
    scrollToBottom(dom.messageArea, true);
  }
}

export function addMessageToUI(message) {
  const wrapper = dom.messageArea.querySelector(".messages-list-wrapper");
  if (!wrapper) return;

  const placeholder = wrapper.querySelector(".list-placeholder");
  if (placeholder) placeholder.remove();

  const typingIndicator = wrapper.querySelector(".typing-indicator-bubble");

  const messageHTML = createMessageHTML(message);
  if (typingIndicator) {
    typingIndicator.insertAdjacentHTML("beforebegin", messageHTML);
  } else {
    wrapper.insertAdjacentHTML("beforeend", messageHTML);
  }

  scrollToBottom(dom.messageArea);
}

export function removeOptimisticMessage(tempId) {
  document.getElementById(tempId)?.remove();
}

export function updateOptimisticMessage(tempId, confirmedMessage) {
  const el = document.getElementById(tempId);
  if (el) {
    el.outerHTML = createMessageHTML(confirmedMessage);
  }
}

export function updateConversationListSnippet(conversationId, latestMessage) {
  // FIX: Ensure numeric comparison for consistency
  const numId = Number(conversationId);
  const convo = appState.conversations.find((c) => c.id === numId);
  if (convo) {
    convo.last_message_content = latestMessage.content;
    convo.last_message_sender = latestMessage.sender_username;
    convo.last_message_ts = latestMessage.timestamp;
    renderConversationList();
  }
}

export function updateChatHeader(conversation) {
  if (!conversation) return;
  showElement(dom.chatViewContent);
  hideElement(dom.chatViewPlaceholder);
  dom.chatPartnerName.textContent = escapeHtml(conversation.partner_username);
  const isOnline =
    conversation.partner_last_active_ts &&
    new Date() - new Date(conversation.partner_last_active_ts) <
      ONLINE_THRESHOLD_MINUTES * 60 * 1000;
  dom.chatPartnerAvatar.classList.toggle("online", isOnline);
  dom.chatPartnerStatus.textContent = formatLastSeen(
    conversation.partner_last_active_ts,
    isOnline
  );
  dom.blockUserButton.dataset.userId = conversation.partner_id;
  showElement(dom.refreshMessagesButton);
  showElement(dom.blockUserButton);
}

export function updateUserOnlineStatus({ userId, status, last_active_ts }) {
  if (!appState.currentUser || userId === appState.currentUser.id) return;

  const newUsers = appState.users.map((u) =>
    u.id === userId ? { ...u, last_active_ts } : u
  );

  const newConversations = appState.conversations.map((c) =>
    c.partner_id === userId
      ? { ...c, partner_last_active_ts: last_active_ts }
      : c
  );

  setState({
    users: newUsers,
    conversations: newConversations,
  });

  const updatedConvoForHeader = newConversations.find(
    (c) => c.id === Number(appState.currentConversationId)
  );
  if (updatedConvoForHeader) {
    updateChatHeader(updatedConvoForHeader);
  }

  renderConversationList();
}

export function renderAdminStats() {
  const stats = appState.adminStats;
  dom.statTotalUsers.textContent = String(stats.userCount ?? "--");
  dom.statTotalMessages.textContent = String(stats.messageCount ?? "--");
  dom.statTotalConversations.textContent = String(
    stats.conversationCount ?? "--"
  );
  dom.statActiveUsers.textContent = String(stats.activeUsers ?? "--");
}

export function renderAdminUserList() {
  if (appState.isLoading.allUsersAdmin) {
    dom.adminUserListBody.innerHTML = `<tr><td colspan="4" class="list-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>`;
    return;
  }
  if (appState.adminUserList.length === 0) {
    dom.adminUserListBody.innerHTML = `<tr><td colspan="4" class="list-placeholder">No users found.</td></tr>`;
    return;
  }
  dom.adminUserListBody.innerHTML = appState.adminUserList
    .map((user) => {
      const isOnline =
        user.last_active_ts &&
        new Date() - new Date(user.last_active_ts) <
          ONLINE_THRESHOLD_MINUTES * 60 * 1000;
      return `
        <tr>
            <td>${user.id}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${formatLastSeen(user.last_active_ts, isOnline)}</td>
            <td>
                <button class="custom-button icon-button" data-action="delete-user-admin" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">
                    <i class="fa-solid fa-trash-can button-icon"></i>
                </button>
            </td>
        </tr>`;
    })
    .join("");
}

export function renderBlockedUsersList() {
  if (appState.isLoading.blockedUsers) {
    dom.blockedUsersList.innerHTML = `<div class="list-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`;
    return;
  }
  if (appState.blockedUsers.length === 0) {
    dom.blockedUsersList.innerHTML = `<p class="list-placeholder">You haven't blocked anyone.</p>`;
    return;
  }
  dom.blockedUsersList.innerHTML = appState.blockedUsers
    .map(
      (user) => `
    <div class="blocked-user-item">
        <div class="blocked-user-info">
            <div class="avatar avatar-small"><i class="fa-solid fa-user"></i></div>
            <span>${escapeHtml(user.username)}</span>
        </div>
        <button class="custom-button button-primary" data-action="unblock-user" data-user-id="${user.id}">
            <span class="button-text">Unblock</span>
            <i class="fa-solid fa-spinner fa-spin button-spinner"></i>
        </button>
    </div>`
    )
    .join("");
}

export function clearChatView() {
  showElement(dom.chatViewPlaceholder);
  hideElement(dom.chatViewContent);
  const wrapper = dom.messageArea.querySelector(".messages-list-wrapper");
  if (wrapper) wrapper.innerHTML = "";
}

export function updateManualLoadButtonVisibility() {
  if (!appState.currentConversationId) return;
  const show =
    !appState.isLoading.olderMessages &&
    !appState.hasReachedOldestMessage.get(
      Number(appState.currentConversationId)
    ) &&
    dom.messageArea.scrollTop < MANUAL_BUTTON_SCROLL_THRESHOLD;
  dom.manualLoadOlderButton.style.display = show ? "flex" : "none";
}

export function scrollToMessage(messageId) {
  const messageElement = document.querySelector(
    `.message[data-message-id="${messageId}"]`
  );
  if (messageElement) {
    messageElement.scrollIntoView({ behavior: "smooth", block: "center" });
    messageElement.classList.add("highlight");
    setTimeout(() => messageElement.classList.remove("highlight"), 1500);
  }
}

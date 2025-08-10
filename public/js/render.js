// public/js/render.js

import { dom } from "./dom.js";
import { appState } from "./state.js";
import {
  escapeHtml,
  formatDate,
  formatLastSeen,
  isMobileView,
} from "./utils.js"; // Corrected import
import {
  ONLINE_THRESHOLD_MINUTES,
  EMOJI_REGEX_CHECK,
  TIME_GAP_THRESHOLD_MINUTES,
  MANUAL_BUTTON_SCROLL_THRESHOLD,
} from "./constants.js";
import { showElement, hideElement, scrollToBottom } from "./ui.js";

function createMessageHTML(msg) {
  const isMyMessage = msg.sender_id === appState.currentUser.id;
  const isEmojiOnly = EMOJI_REGEX_CHECK.test(msg.content);
  const idAttr = msg.isOptimistic ? `id="${msg.id}"` : "";
  let replyHTML = "";

  if (msg.reply_to_message_id) {
    const originalSender = escapeHtml(msg.reply_sender_username || "User");
    const snippetText = escapeHtml(msg.reply_snippet || "Original message");
    replyHTML = `<div class="reply-snippet" data-action="scroll-to-reply" data-reply-to-id="${msg.reply_to_message_id}"><strong>${originalSender}</strong><span>${snippetText}</span></div>`;
  }

  return `
        <div class="message ${isMyMessage ? "sent" : "received"} ${isEmojiOnly ? "message-emoji-only" : ""}" ${idAttr} data-message-id="${msg.id}">
            ${replyHTML}
            <div class="message-content">${escapeHtml(msg.content)}</div>
            <div class="message-meta">
                <span class="message-timestamp">${formatDate(msg.timestamp)}</span>
                ${msg.is_edited ? '<span class="edited-indicator">(edited)</span>' : ""}
            </div>
            <div class="message-actions">
                <button class="message-action-button" data-action="reply-message" title="Reply"><i class="fa-solid fa-reply"></i></button>
                ${isMyMessage ? `<button class="message-action-button" data-action="edit-message" title="Edit"><i class="fa-solid fa-pencil"></i></button>` : ""}
                ${isMyMessage ? `<button class="message-action-button" data-action="delete-message" title="Delete"><i class="fa-solid fa-trash-can"></i></button>` : ""}
            </div>
        </div>
    `;
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
    dom.conversationListArea.innerHTML = `<div class="list-placeholder">${searchTerm ? "No results found." : "No conversations."}</div>`;
    return;
  }

  dom.conversationListArea.innerHTML = filteredItems
    .map((item) => {
      if (item.type === "user") {
        const isOnline =
          item.last_active_ts &&
          new Date() - new Date(item.last_active_ts) <
            ONLINE_THRESHOLD_MINUTES * 60 * 1000;
        return `
                <div class="conversation-item user-list-item" data-action="startConversation" data-user-id="${item.id}">
                    <div class="avatar avatar-small ${isOnline ? "online" : "offline"}"><i class="fa-solid fa-user"></i></div>
                    <div class="conversation-details">
                        <span class="conversation-name">${escapeHtml(item.username)}</span>
                        <span class="conversation-snippet">Click to start chat</span>
                    </div>
                </div>`;
      } else {
        const isOnline =
          item.partner_last_active_ts &&
          new Date() - new Date(item.partner_last_active_ts) <
            ONLINE_THRESHOLD_MINUTES * 60 * 1000;
        const snippet =
          item.last_message_sender === appState.currentUser.username
            ? `You: ${escapeHtml(item.last_message_content)}`
            : escapeHtml(item.last_message_content);
        return `
                <div class="conversation-item ${item.id == appState.currentConversationId ? "active" : ""}" data-action="selectConversation" data-conversation-id="${item.id}">
                    <div class="avatar avatar-small ${isOnline ? "online" : "offline"}"><i class="fa-solid fa-user"></i></div>
                    <div class="conversation-details">
                        <span class="conversation-name">${escapeHtml(item.partner_username)}</span>
                        <span class="conversation-snippet">${snippet || "No messages yet"}</span>
                    </div>
                    <div class="conversation-meta">
                        ${item.last_message_ts ? `<span class="conversation-timestamp">${formatDate(item.last_message_ts)}</span>` : ""}
                        ${item.unread_count > 0 ? '<div class="unread-indicator"></div>' : ""}
                    </div>
                </div>`;
      }
    })
    .join("");
}

export function renderMessages(conversationId) {
  const messages = appState.messages.get(conversationId) || [];

  if (appState.isLoading.messages && messages.length === 0) {
    dom.messageArea.innerHTML = `<div class="message-placeholder-style"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`;
    return;
  }

  if (messages.length === 0) {
    dom.messageArea.innerHTML = `<div class="message-placeholder-style">No messages yet. Send an aura wave!</div>`;
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
      messagesHtml += `<div class="message-time-gap-marker">${currentTimestamp.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</div>`;
    }

    messagesHtml += createMessageHTML(msg);
    lastTimestamp = currentTimestamp;
  });

  dom.messageArea.innerHTML = messagesHtml;
  scrollToBottom(dom.messageArea, true);
}

export function addMessageToUI(message) {
  const placeholder = dom.messageArea.querySelector(
    ".message-placeholder-style"
  );
  if (placeholder) placeholder.remove();
  dom.messageArea.insertAdjacentHTML("beforeend", createMessageHTML(message));
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
  const convo = appState.conversations.find((c) => c.id == conversationId);
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
  dom.chatPartnerStatus.classList.toggle("online", isOnline);
  dom.chatPartnerStatusText.textContent = formatLastSeen(
    conversation.partner_last_active_ts,
    isOnline
  );
  dom.blockUserButton.dataset.userId = conversation.partner_id;
  showElement(dom.refreshMessagesButton);
  showElement(dom.blockUserButton);
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
                    <button class="custom-button icon-button action-button" data-action="delete-user-admin" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
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
                <div class="avatar avatar-small offline"><i class="fa-solid fa-user"></i></div>
                <span>${escapeHtml(user.username)}</span>
            </div>
            <button class="custom-button unblock-button" data-action="unblock-user" data-user-id="${user.id}">Unblock</button>
        </div>
    `
    )
    .join("");
}

export function clearChatView() {
  showElement(dom.chatViewPlaceholder);
  hideElement(dom.chatViewContent);
  dom.messageArea.innerHTML = "";
}

export function updateMessageReadStatusUI(messageElement, isReadByPartner) {
  const statusElement = messageElement?.querySelector(".message-read-status");
  if (statusElement) {
    statusElement.innerHTML = isReadByPartner
      ? '<i class="fa-solid fa-check-double"></i>'
      : '<i class="fa-solid fa-check"></i>';
    statusElement.classList.toggle("read", isReadByPartner);
  }
}

export function updateManualLoadButtonVisibility() {
  if (!appState.currentConversationId) return;
  const show =
    !appState.isLoading.olderMessages &&
    !appState.hasReachedOldestMessage.get(appState.currentConversationId) &&
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

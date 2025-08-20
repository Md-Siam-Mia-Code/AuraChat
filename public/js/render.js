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
  GLOBAL_CONVERSATION_ID,
} from "./constants.js";
import { scrollToBottom } from "./ui.js";
import * as api from "./api.js";
import { setupReadReceiptsObserver } from "./main.js";

function createMessageHTML(msg) {
  const isMyMessage = msg.sender_id === appState.currentUser.id;
  const isEmojiOnly = msg.content && EMOJI_REGEX_CHECK.test(msg.content);
  const idAttr = msg.isOptimistic ? `id="${msg.id}"` : "";
  let replyHTML = "";
  let readReceiptHTML = "";

  if (msg.reply_to_message_id) {
    const originalSender = escapeHtml(msg.reply_sender_username || "User");
    const snippetText = escapeHtml(msg.reply_snippet || "Original message");
    replyHTML = `<div class="reply-snippet" data-action="scroll-to-reply" data-reply-to-id="${msg.reply_to_message_id}"><strong>${originalSender}</strong><span>${snippetText}</span></div>`;
  }

  if (isMyMessage && !msg.isOptimistic) {
    const isRead = !!msg.is_read_by_partner;
    readReceiptHTML = `<span class="read-receipts ${isRead ? "read" : ""}"><i class="fa-solid fa-check-double"></i></span>`;
  }

  return `
    <div class="message ${isMyMessage ? "sent" : "received"} ${isEmojiOnly ? "message-emoji-only" : ""}" ${idAttr} data-message-id="${msg.id}" data-sender-id="${msg.sender_id}">
        <div class="message-swipe-indicator"><i class="fa-solid fa-reply"></i></div>
        <div class="message-content-wrapper">
            ${replyHTML}
            <div class="message-content">${escapeHtml(msg.content)}</div>
            <div class="message-meta">
                <span class="message-timestamp">${formatDate(msg.timestamp)}</span>
                ${msg.is_edited ? '<span class="edited-indicator">(edited)</span>' : ""}
                ${readReceiptHTML}
            </div>
        </div>
        <div class="message-actions">
            <button class="message-action-button" data-action="reply-message" aria-label="Reply"><i class="fa-solid fa-reply"></i></button>
            ${isMyMessage ? `<button class="message-action-button" data-action="edit-message" aria-label="Edit"><i class="fa-solid fa-pencil"></i></button>` : ""}
            ${isMyMessage ? `<button class="message-action-button" data-action="delete-message" aria-label="Delete"><i class="fa-solid fa-trash-can"></i></button>` : ""}
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
  if (Number(conversationId) !== GLOBAL_CONVERSATION_ID) return;

  const newMessagesMap = new Map(appState.messages);
  const messages = newMessagesMap.get(GLOBAL_CONVERSATION_ID) || [];
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
  newMessagesMap.set(GLOBAL_CONVERSATION_ID, newMessages);
  setState({ messages: newMessagesMap });

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
      messageElement
        .querySelector(".message-meta")
        .insertBefore(
          indicator,
          messageElement.querySelector(".read-receipts")
        );
    }
  }
}

export function handleMessageDelete({ messageId, conversationId }) {
  if (Number(conversationId) !== GLOBAL_CONVERSATION_ID) return;

  const newMessagesMap = new Map(appState.messages);
  const messages = newMessagesMap.get(GLOBAL_CONVERSATION_ID) || [];
  newMessagesMap.set(
    GLOBAL_CONVERSATION_ID,
    messages.filter((m) => String(m.id) !== String(messageId))
  );
  setState({ messages: newMessagesMap });

  const messageElement = document.querySelector(
    `[data-message-id="${messageId}"]`
  );
  if (messageElement) {
    messageElement.style.opacity = "0";
    setTimeout(() => messageElement.remove(), 300);
  }
}

export function handleReadReceiptUpdate({ messageIds, readerId }) {
  if (readerId === appState.currentUser.id) return;
  messageIds.forEach((id) => {
    const msgEl = document.querySelector(`.message[data-message-id="${id}"]`);
    if (msgEl && msgEl.dataset.senderId == appState.currentUser.id) {
      const receiptEl = msgEl.querySelector(".read-receipts");
      if (receiptEl) {
        receiptEl.classList.add("read");
      }
    }
  });
}

export function renderMessages(conversationId, options = {}) {
  const wrapper = dom.messageArea.querySelector(".messages-list-wrapper");
  if (!wrapper) return;

  const oldScrollHeight = dom.messageArea.scrollHeight;
  const messages = appState.messages.get(conversationId) || [];

  if (appState.isLoading.messages && messages.length === 0) {
    wrapper.innerHTML = `<div class="list-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Loading messages...</div>`;
    return;
  }
  if (messages.length === 0) {
    wrapper.innerHTML = `<div class="list-placeholder">No messages yet. Send a lovely message!</div>`;
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom(dom.messageArea, true);
      });
    });
  }
}

export function addMessageToUI(message) {
  const wrapper = dom.messageArea.querySelector(".messages-list-wrapper");
  if (!wrapper) return;

  const isScrolledToBottom =
    dom.messageArea.scrollHeight - dom.messageArea.clientHeight <=
    dom.messageArea.scrollTop + 50;

  const placeholder = wrapper.querySelector(".list-placeholder");
  if (placeholder) placeholder.remove();

  const typingIndicator = wrapper.querySelector(".typing-indicator-bubble");
  const messageHTML = createMessageHTML(message);

  if (typingIndicator) {
    typingIndicator.insertAdjacentHTML("beforebegin", messageHTML);
  } else {
    wrapper.insertAdjacentHTML("beforeend", messageHTML);
  }

  if (isScrolledToBottom) {
    scrollToBottom(dom.messageArea);
  }

  const newEl = wrapper.querySelector(`[data-message-id="${message.id}"]`);
  if (newEl && newEl.classList.contains("received")) {
    setupReadReceiptsObserver();
  }
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

export function updateChatHeader() {
  const partner = appState.users.find((u) => u.id !== appState.currentUser.id);
  if (partner) {
    dom.chatPartnerName.innerHTML = `${escapeHtml(partner.username)} <i class="fa-solid fa-heart header-heart"></i>`;
    const isOnline =
      partner.last_active_ts &&
      new Date() - new Date(partner.last_active_ts) <
        ONLINE_THRESHOLD_MINUTES * 60 * 1000;
    dom.chatPartnerAvatar.classList.toggle("online", isOnline);
    dom.chatPartnerAvatar.querySelector("i").className = "fa-solid fa-heart";
    dom.chatPartnerStatus.textContent = formatLastSeen(
      partner.last_active_ts,
      isOnline
    );
  } else {
    dom.chatPartnerName.textContent = "Waiting for partner...";
    dom.chatPartnerAvatar.classList.remove("online");
    dom.chatPartnerAvatar.querySelector("i").className =
      "fa-solid fa-user-secret";
    dom.chatPartnerStatus.textContent = "Offline";
  }
}

export function updateUserOnlineStatus({ userId, last_active_ts }) {
  if (!appState.currentUser || userId === appState.currentUser.id) return;

  const newUsers = appState.users.map((u) =>
    u.id === userId ? { ...u, last_active_ts } : u
  );
  setState({ users: newUsers });

  updateChatHeader();
}

export function renderAdminStats() {
  if (!dom.statTotalUsers) return;
  const stats = appState.adminStats;
  dom.statTotalUsers.textContent = String(stats.userCount ?? "--");
  dom.statTotalMessages.textContent = String(stats.messageCount ?? "--");
  dom.statTotalConversations.textContent = String(
    stats.conversationCount ?? "--"
  );
  dom.statActiveUsers.textContent = String(stats.activeUsers ?? "--");
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

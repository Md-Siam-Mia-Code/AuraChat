// public/js/main.js

import { dom } from "./dom.js";
import { appState } from "./state.js";
import { debounce, isTouchDevice, getInitialTheme } from "./utils.js";
import {
  initializeApp,
  showUserLoginForm,
  showAdminLoginForm,
  selectConversation,
} from "./view.js";
import {
  handleConfirmation,
  hideError,
  adjustTextareaHeight,
  hideEmojiPanel,
  toggleEmojiPanel,
  updateSendButtonState,
  applyTheme,
  showElement,
  hideElement,
} from "./ui.js";
import {
  renderConversationList,
  updateManualLoadButtonVisibility,
} from "./render.js";
import * as api from "./api.js";
import { disconnectWebSocket } from "./websocket.js";

function handleThemeToggle() {
  const current = dom.html.dataset.theme || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
}

function handleMobileMenuToggle() {
  dom.body.classList.toggle("left-panel-active");
}

function closeMobilePanel() {
  dom.body.classList.remove("left-panel-active");
}

function logout() {
  disconnectWebSocket();
  sessionStorage.removeItem("connected-session-v2");
  window.location.reload();
}

const debouncedScrollHandler = debounce(() => {
  updateManualLoadButtonVisibility();
  if (
    dom.messageArea.scrollTop < 100 &&
    !appState.isLoading.olderMessages &&
    appState.currentConversationId
  ) {
    api.fetchOlderMessages(appState.currentConversationId);
  }
  hideEmojiPanel();
}, 150);

function attachEventListeners() {
  dom.onboardingForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    api.handleOnboardingSubmit();
  });
  dom.userLoginForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    api.handleUserLoginSubmit();
  });
  dom.adminLoginForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    api.handleAdminLoginSubmit();
  });
  dom.adminAddUserForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    api.handleAdminAddUserSubmit();
  });

  dom.userLoginTab?.addEventListener("click", showUserLoginForm);
  dom.adminLoginTab?.addEventListener("click", showAdminLoginForm);
  dom.switchToUserLoginButtons.forEach((btn) =>
    btn.addEventListener("click", showUserLoginForm)
  );

  dom.errorBannerClose?.addEventListener("click", hideError);
  dom.confirmYesButton?.addEventListener("click", () =>
    handleConfirmation(true)
  );
  dom.confirmNoButton?.addEventListener("click", () =>
    handleConfirmation(false)
  );
  dom.confirmationModalOverlay?.addEventListener("click", (e) => {
    if (e.target === dom.confirmationModalOverlay) handleConfirmation(false);
  });
  dom.manageBlocksButton?.addEventListener("click", () => {
    showElement(dom.manageBlocksModal);
    api.fetchBlockedUsers();
  });
  dom.modalCloseButtons.forEach((btn) =>
    btn.addEventListener("click", () => hideElement(dom.manageBlocksModal))
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (dom.confirmationModalOverlay?.style.display !== "none")
        handleConfirmation(false);
      else if (appState.editingMessageId) api.cancelEdit();
      else if (appState.replyingToMessageId) api.cancelReply();
      else if (dom.manageBlocksModal?.style.display !== "none")
        hideElement(dom.manageBlocksModal);
      else if (dom.emojiPanel?.style.display !== "none") hideEmojiPanel();
      else if (
        isTouchDevice() &&
        dom.body.classList.contains("left-panel-active")
      )
        closeMobilePanel();
    }
  });

  dom.logoutButton?.addEventListener("click", logout);
  dom.adminLogoutButton?.addEventListener("click", logout);
  dom.themeToggleButton?.addEventListener("click", handleThemeToggle);
  dom.adminThemeToggleButton?.addEventListener("click", handleThemeToggle);
  dom.conversationSearch?.addEventListener(
    "input",
    debounce(renderConversationList, 250)
  );
  dom.mobileMenuToggle?.addEventListener("click", handleMobileMenuToggle);
  dom.mobilePlaceholderMenuToggle?.addEventListener(
    "click",
    handleMobileMenuToggle
  );
  dom.panelOverlay?.addEventListener("click", closeMobilePanel);

  dom.sendButton?.addEventListener("click", api.handleSendMessage);
  dom.messageInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      api.handleSendMessage();
    }
  });
  dom.messageInput?.addEventListener("input", updateSendButtonState);
  dom.refreshMessagesButton?.addEventListener("click", () => {
    if (appState.currentConversationId)
      api.fetchMessagesForConversation(appState.currentConversationId, true);
  });
  dom.emojiToggleButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleEmojiPanel();
  });
  dom.messageArea?.addEventListener("scroll", debouncedScrollHandler);
  dom.manualLoadOlderButton?.addEventListener("click", () => {
    if (appState.currentConversationId)
      api.fetchOlderMessages(appState.currentConversationId);
  });
  dom.blockUserButton?.addEventListener("click", api.handleBlockUser);
  dom.cancelReplyButton?.addEventListener("click", api.cancelReply);

  document.body.addEventListener("click", (e) => {
    const delegate = e.target.closest("[data-action]");
    if (!delegate) return;

    const { action, conversationId, userId } = delegate.dataset;
    const messageEl = delegate.closest(".message");
    const messageId = messageEl ? messageEl.dataset.messageId : null;

    switch (action) {
      case "selectConversation":
        if (conversationId) selectConversation(conversationId);
        break;
      case "startConversation":
        if (userId) api.handleStartNewConversation(userId);
        break;
      case "unblock-user":
        api.handleUnblockUser(delegate);
        break;
      case "delete-user-admin":
        api.handleAdminDeleteUser(delegate);
        break;
      case "delete-message":
        if (messageId && messageEl)
          api.handleDeleteMessage(messageId, messageEl);
        break;
      case "edit-message":
        if (messageId && messageEl)
          api.handleShowEditInput(messageId, messageEl);
        break;
      case "reply-message":
        if (messageId) api.handleReplyToMessage(messageId);
        break;
      case "scroll-to-reply":
        api.scrollToReply(delegate.dataset.replyToId);
        break;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Aura Chat Initializing...");
  applyTheme(getInitialTheme());
  attachEventListeners();
  initializeApp();
});

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
import { disconnectWebSocket, sendTypingEvent } from "./websocket.js";
import { SWIPE_THRESHOLD } from "./constants.js";

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

// --- START: CORRECTED TYPING INDICATOR LOGIC ---
let typingTimer = null;
const TYPING_TIMER_LENGTH = 3000; // 3 seconds

function handleTypingInput() {
  updateSendButtonState();
  adjustTextareaHeight();

  // If there is no timer, it means we are starting a new typing burst.
  if (typingTimer === null) {
    sendTypingEvent("start");
  } else {
    // If a timer already exists, clear it because the user is still typing.
    clearTimeout(typingTimer);
  }

  // Set a new timer. If the user stops typing, this will fire after 3 seconds.
  typingTimer = setTimeout(() => {
    sendTypingEvent("stop");
    // Reset the timer state, allowing the next keystroke to trigger a "start" event.
    typingTimer = null;
  }, TYPING_TIMER_LENGTH);
}

function handleSendMessageWithTypingReset() {
  if (dom.messageInput.value.trim().length === 0) return;
  api.handleSendMessage();

  // Immediately stop the typing indicator flow when a message is sent.
  if (typingTimer) {
    clearTimeout(typingTimer);
  }
  sendTypingEvent("stop");
  typingTimer = null;
}
// --- END: CORRECTED TYPING INDICATOR LOGIC ---

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

  dom.sendButton?.addEventListener("click", handleSendMessageWithTypingReset);
  dom.messageInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessageWithTypingReset();
    }
  });
  dom.messageInput?.addEventListener("input", handleTypingInput);
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

  // Swipe to reply logic
  let touchStartX = 0,
    touchStartY = 0;
  let touchCurrentX = 0,
    touchCurrentY = 0;
  let isSwiping = false;
  let swipedElement = null;
  let swipedContentWrapper = null;
  let swipeIndicator = null;
  let swipeDirectionLocked = false;

  dom.messageArea?.addEventListener(
    "touchstart",
    (e) => {
      const target = e.target.closest(".message");
      if (!target || appState.editingMessageId) return;

      isSwiping = true;
      swipedElement = target;
      swipedContentWrapper = swipedElement.querySelector(
        ".message-content-wrapper"
      );
      swipeIndicator = swipedElement.querySelector(".message-swipe-indicator");
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    },
    { passive: true }
  );

  dom.messageArea?.addEventListener("touchmove", (e) => {
    if (!isSwiping || !swipedElement) return;

    touchCurrentX = e.touches[0].clientX;
    touchCurrentY = e.touches[0].clientY;
    let diffX = touchCurrentX - touchStartX;
    let diffY = touchCurrentY - touchStartY;

    if (!swipeDirectionLocked) {
      if (Math.abs(diffX) > Math.abs(diffY)) {
        swipeDirectionLocked = "horizontal";
      } else {
        swipeDirectionLocked = "vertical";
      }
    }

    if (swipeDirectionLocked === "horizontal") {
      e.preventDefault(); // Prevent vertical scroll when swiping horizontally

      if (
        (swipedElement.classList.contains("sent") && diffX > 0) ||
        (swipedElement.classList.contains("received") && diffX < 0)
      ) {
        diffX = 0;
      }

      const swipeAmount = Math.max(-100, Math.min(100, diffX));
      const opacity = Math.min(Math.abs(swipeAmount) / SWIPE_THRESHOLD, 1);
      const scale = 0.5 + opacity * 0.5; // Grow from 0.5 to 1

      swipedContentWrapper.classList.add("swiping");
      swipedContentWrapper.style.transform = `translateX(${swipeAmount}px)`;
      if (swipeIndicator) {
        swipeIndicator.style.opacity = opacity;
        swipeIndicator.style.transform = `scale(${scale})`;
      }
    }
  });

  dom.messageArea?.addEventListener("touchend", (e) => {
    if (!isSwiping || !swipedElement) return;

    const diffX = touchCurrentX - touchStartX;
    const isSent = swipedElement.classList.contains("sent");
    const isReceived = swipedElement.classList.contains("received");

    if (swipeDirectionLocked === "horizontal") {
      if (
        (isReceived && diffX > SWIPE_THRESHOLD) ||
        (isSent && diffX < -SWIPE_THRESHOLD)
      ) {
        const messageId = swipedElement.dataset.messageId;
        api.handleReplyToMessage(messageId);
      }
    }

    swipedContentWrapper.classList.remove("swiping");
    swipedContentWrapper.classList.add("resetting");
    swipedContentWrapper.style.transform = "translateX(0)";
    if (swipeIndicator) {
      swipeIndicator.style.opacity = 0;
      swipeIndicator.style.transform = "scale(0.5)";
    }

    swipedContentWrapper.addEventListener(
      "transitionend",
      () => {
        swipedContentWrapper.classList.remove("resetting");
      },
      { once: true }
    );

    isSwiping = false;
    swipedElement = null;
    swipeDirectionLocked = false;
  });

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
          api.startEditingMessage(messageId, messageEl);
        break;
      case "cancel-edit":
        api.cancelEdit();
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

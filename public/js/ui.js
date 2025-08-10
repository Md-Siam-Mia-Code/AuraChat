import { dom } from "./dom.js";
import {
  appState,
  currentErrorTimeout,
  confirmationResolver,
  setConfirmationResolver,
  setCurrentErrorTimeout,
} from "./state.js";
import { THEME_STORAGE_KEY, COMMON_EMOJIS } from "./constants.js";
import * as api from "./api.js";

export const showElement = (el) => {
  if (!el) return;
  el.style.display = el.dataset.displayStyle || "flex";
};
export const hideElement = (el) => el && (el.style.display = "none");
export const setButtonLoading = (btn, isLoading) => {
  if (!btn) return;
  btn.classList.toggle("disabled", isLoading);
  btn.setAttribute("aria-disabled", isLoading);
  const spinner = btn.querySelector(".button-spinner");
  const content = btn.querySelector(".button-text, .button-icon");
  if (spinner) spinner.style.display = isLoading ? "inline-block" : "none";
  if (content) {
    content.style.display = isLoading ? "none" : "";
  }
};
export function showError(message, duration = 5000) {
  dom.errorBannerMessage.textContent =
    message || "An unexpected error occurred.";
  showElement(dom.errorBanner);
  dom.errorBanner.classList.add("show");
  if (currentErrorTimeout) clearTimeout(currentErrorTimeout);
  setCurrentErrorTimeout(setTimeout(hideError, duration));
}
export function hideError() {
  dom.errorBanner.classList.remove("show");
}
export function showConfirmation(message) {
  return new Promise((resolve) => {
    dom.confirmationMessage.textContent = message;
    showElement(dom.confirmationModalOverlay);
    setConfirmationResolver(resolve);
    dom.confirmNoButton.focus();
  });
}
export function handleConfirmation(result) {
  hideElement(dom.confirmationModalOverlay);
  if (confirmationResolver) {
    confirmationResolver(result);
    setConfirmationResolver(null);
  }
}
export function scrollToBottom(el, immediate = false) {
  if (el)
    el.scrollTo({
      top: el.scrollHeight,
      behavior: immediate ? "instant" : "smooth",
    });
}
export function adjustTextareaHeight(textarea = dom.messageInput) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
}
export function updateSendButtonState() {
  const canSend =
    !appState.isLoading.sendingMessage &&
    dom.messageInput.value.trim().length > 0;
  dom.sendButton.classList.toggle("disabled", !canSend);
  dom.sendButton.setAttribute("aria-disabled", !canSend);
}
export function applyTheme(theme) {
  dom.html.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  [dom.themeToggleButton, dom.adminThemeToggleButton].forEach((btn) => {
    if (btn) {
      const icon = btn.querySelector("i");
      icon.classList.toggle("fa-moon", theme === "dark");
      icon.classList.toggle("fa-sun", theme === "light");
    }
  });
}
export function setFormError(formName, message) {
  const el = dom[`${formName}Error`];
  if (el) {
    el.textContent = message || "";
    el.style.display = message ? "block" : "none";
  }
}
export function toggleEmojiPanel() {
  if (dom.emojiPanel.style.display === "none") {
    populateEmojiPanel();
    showElement(dom.emojiPanel);
  } else {
    hideElement(dom.emojiPanel);
  }
}
export function hideEmojiPanel() {
  if (dom.emojiPanel) hideElement(dom.emojiPanel);
}
function populateEmojiPanel() {
  if (dom.emojiGrid.childElementCount > 0) return;
  COMMON_EMOJIS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.className = "emoji-item";
    btn.textContent = emoji;
    btn.type = "button";
    btn.addEventListener("click", () => {
      dom.messageInput.value += emoji;
      dom.messageInput.focus();
      updateSendButtonState();
    });
    dom.emojiGrid.appendChild(btn);
  });
}

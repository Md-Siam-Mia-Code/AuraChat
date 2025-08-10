// public/js/utils.js

import {
  THEME_STORAGE_KEY,
  ONLINE_THRESHOLD_MINUTES,
  MOBILE_BREAKPOINT,
} from "./constants.js";

export const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

export const formatDate = (isoString) => {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "Invalid time";
  }
};

export function escapeHtml(unsafe) {
  return unsafe
    ? String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
    : "";
}

export const isTouchDevice = () =>
  "ontouchstart" in window || navigator.maxTouchPoints > 0;

export function formatLastSeen(isoString, isOnline) {
  if (isOnline) return "Online";
  if (!isoString) return "Offline";
  try {
    const lastActiveDate = new Date(isoString);
    const now = new Date();
    const diffSeconds = (now.getTime() - lastActiveDate.getTime()) / 1000;

    if (diffSeconds < 60) return `Active: just now`;
    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) return `Active: ${diffMinutes}m ago`;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastActiveDay = new Date(
      lastActiveDate.getFullYear(),
      lastActiveDate.getMonth(),
      lastActiveDate.getDate()
    );

    if (today.getTime() === lastActiveDay.getTime()) {
      return `Active today at ${lastActiveDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}`;
    }

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (yesterday.getTime() === lastActiveDay.getTime()) {
      return `Active yesterday at ${lastActiveDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}`;
    }
    return `Active: ${lastActiveDate.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  } catch {
    return "Offline";
  }
}

export function getInitialTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" || saved === "dark"
    ? saved
    : window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? "dark"
      : "light";
}

// THIS FUNCTION WAS MISSING
export const isMobileView = () => window.innerWidth <= MOBILE_BREAKPOINT;

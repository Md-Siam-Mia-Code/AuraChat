// public/js/constants.js
export const POLLING_INTERVAL_MS = 3500;
export const STATUS_UPDATE_INTERVAL_MS = 60000;
export const WS_HEARTBEAT_INTERVAL_MS = 30000;
export const ONLINE_THRESHOLD_MINUTES = 1;
export const TIME_GAP_THRESHOLD_MINUTES = 10;
export const CONSECUTIVE_MESSAGE_THRESHOLD_MS = 60 * 1000;
export const API_BASE_URL = "/api";
export const THEME_STORAGE_KEY = "connected-theme";
export const SESSION_STORAGE_KEY = "connected-session-v2";
export const MOBILE_BREAKPOINT = 768;
export const MESSAGES_INITIAL_LOAD_LIMIT = 50;
export const MESSAGES_LOAD_OLDER_LIMIT = 30;
export const SCROLL_LOAD_THRESHOLD = 100;
export const MANUAL_BUTTON_SCROLL_THRESHOLD = 150;
export const SWIPE_THRESHOLD = 60; // Pixels required to trigger reply
export const WEBSOCKET_URL =
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
  window.location.host +
  "/ws";
export const EMOJI_REGEX_CHECK =
  /^(?:[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}️?]){1,3}$/u;
export const COMMON_EMOJIS = [
  "😀",
  "😂",
  "❤️",
  "👍",
  "🤔",
  "😎",
  "🥳",
  "😊",
  "😇",
  "🥰",
  "😍",
  "🤩",
  "😘",
  "🥲",
  "😋",
  "😛",
  "😜",
  "🤪",
  "😝",
  "🤑",
  "🤫",
  "🤞",
  "💯",
  "🎉",
  "✨",
  "🔥",
  "👋",
  "🙏",
  "🤝",
  "👀",
  "😭",
  "😢",
  "😕",
  "🙁",
  "😬",
  "🙄",
  "🤢",
  "🤮",
  "👉",
  "👈",
  "👇",
  "👆",
];

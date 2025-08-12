// public/js/state.js
export const appState = {
  currentView: "loading",
  currentUser: null,
  currentConversationId: null,
  conversations: [],
  users: [],
  blockedUsers: [],
  messages: new Map(),
  oldestMessageTimestamp: new Map(),
  hasReachedOldestMessage: new Map(),
  lastMessageSenderIdMap: new Map(),
  lastMessageTimestampMap: new Map(),
  typingIndicators: new Map(),
  adminStats: {},
  adminUserList: [],
  isLoading: {
    auth: false,
    init: false,
    messages: false,
    olderMessages: false,
    conversations: false,
    users: false,
    blockedUsers: false,
    adminStats: false,
    allUsersAdmin: false,
    sendingMessage: false,
    blockingUser: false,
    deletingMessage: false,
    adminAction: false,
  },
  editingMessageId: null,
  replyingToMessageId: null,
  ws: null,
};
export let messagePollingInterval = null;
export let statusUpdateInterval = null;
export let wsHeartbeatInterval = null;
export let currentErrorTimeout = null;
export let confirmationResolver = null;
export function setState(newState) {
  Object.assign(appState, newState);
}
export function setConfirmationResolver(resolver) {
  confirmationResolver = resolver;
}
export function setMessagePollingInterval(interval) {
  messagePollingInterval = interval;
}
export function setStatusUpdateInterval(interval) {
  statusUpdateInterval = interval;
}
export function setWsHeartbeatInterval(interval) {
  wsHeartbeatInterval = interval;
}
export function setCurrentErrorTimeout(timeout) {
  currentErrorTimeout = timeout;
}

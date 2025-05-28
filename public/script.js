document.addEventListener('DOMContentLoaded', () => {
	console.log('Aura Chat Initializing...');

	const appState = {
		currentView: 'loading', currentUser: null, currentConversationId: null,
		conversations: [], users: [], blockedUsers: [], messages: new Map(),
		oldestMessageTimestamp: new Map(), hasReachedOldestMessage: new Map(),
		lastMessageSenderIdMap: new Map(), lastMessageTimestampMap: new Map(),
		adminStats: {}, adminUserList: [],
		isLoading: {
			auth: false, init: false, messages: false, olderMessages: false,
			conversations: false, users: false, blockedUsers: false,
			adminStats: false, allUsersAdmin: false, sendingMessage: false,
			blockingUser: false, deletingMessage: false, adminAction: false,
		},
		editingMessageId: null, replyingToMessageId: null,
		globalError: null,
		formErrors: { login: null, onboarding: null, adminUser: null, manageBlocks: null },
		swipeState: { startX: 0, startY: 0, currentX: 0, currentY: 0, messageEl: null, isSwiping: false, targetId: null, confirmedSwipe: false },
		ws: null,
		lastFocusedElement: null
	};

	let messagePollingInterval = null;
	let statusUpdateInterval = null;
	let wsHeartbeatInterval = null;
	let currentErrorTimeout = null;
	let confirmationResolver = null;

	// --- CONSTANTS ---
	const POLLING_INTERVAL_MS = 3500;
	const STATUS_UPDATE_INTERVAL_MS = 60000;
	const WS_HEARTBEAT_INTERVAL_MS = 30000;
	const ONLINE_THRESHOLD_MINUTES = 1;
	const TIME_GAP_THRESHOLD_MINUTES = 10;
	const CONSECUTIVE_MESSAGE_THRESHOLD_MS = 60 * 1000;
	const SWIPE_THRESHOLD = 50; // Pixels
	const SWIPE_ANGLE_THRESHOLD = Math.PI / 6; // ~30 degrees
	const SWIPE_VERTICAL_MAX_DEVIATION = 30; // Max Y movement

	const API_BASE_URL = '/api';
	const THEME_STORAGE_KEY = 'connected-theme';
	const SESSION_STORAGE_KEY = 'connected-session-v2';
	const MOBILE_BREAKPOINT = 768;
	const MESSAGES_INITIAL_LOAD_LIMIT = 50;
	const MESSAGES_LOAD_OLDER_LIMIT = 30;
	const SCROLL_LOAD_THRESHOLD = 100; // For automatic loading
	const MANUAL_BUTTON_SCROLL_THRESHOLD = 150; // Threshold to show manual load button

	// Ensure WEBSOCKET_URL is defined here
	const WEBSOCKET_URL = (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/ws";
	// --- END CONSTANTS ---


	const dom = {
		body: document.body,
		html: document.documentElement,
		loadingScreen: document.getElementById('loading-screen'),
		onboardingScreen: document.getElementById('onboarding-screen'),
		loginScreen: document.getElementById('login-screen'),
		chatAppScreen: document.getElementById('chat-app'),
		adminDashboardScreen: document.getElementById('admin-dashboard'),
		errorBanner: document.getElementById('error-banner'),
		errorBannerMessage: document.getElementById('error-banner-message'),
		errorBannerClose: document.getElementById('error-banner-close'),
		confirmationModalOverlay: document.getElementById('confirmation-modal-overlay'),
		confirmationModal: document.getElementById('confirmation-modal'),
		confirmationMessage: document.getElementById('confirmation-message'),
		confirmYesButton: document.getElementById('confirm-yes-button'),
		confirmNoButton: document.getElementById('confirm-no-button'),
		onboardingForm: document.getElementById('onboarding-form'),
		onboardingError: document.getElementById('onboarding-error'),
		onboardingSubmit: document.getElementById('onboarding-submit'),
		onboardingUsername: document.getElementById('onboarding-username'),
		onboardingUsernameProxy: document.getElementById('onboarding-username-proxy'),
		onboardingPassword: document.getElementById('onboarding-password'),
		onboardingPasswordProxy: document.getElementById('onboarding-password-proxy'),
		onboardingMasterPassword: document.getElementById('onboarding-master-password'),
		onboardingMasterPasswordProxy: document.getElementById('onboarding-master-password-proxy'),
		loginError: document.getElementById('login-error'),
		userLoginTab: document.getElementById('user-login-tab'),
		adminLoginTab: document.getElementById('admin-login-tab'),
		userLoginForm: document.getElementById('user-login-form'),
		adminLoginForm: document.getElementById('admin-login-form'),
		loginUsername: document.getElementById('login-username'),
		loginUsernameProxy: document.getElementById('login-username-proxy'),
		loginPassword: document.getElementById('login-password'),
		loginPasswordProxy: document.getElementById('login-password-proxy'),
		loginSubmit: document.getElementById('login-submit'),
		adminMasterPassword: document.getElementById('admin-master-password'),
		adminMasterPasswordProxy: document.getElementById('admin-master-password-proxy'),
		adminLoginSubmit: document.getElementById('admin-login-submit'),
		switchToUserLoginButtons: document.querySelectorAll('.switch-to-user-login'),
		leftPanel: document.querySelector('.left-panel'),
		panelOverlay: document.getElementById('panel-overlay'),
		myAvatarSummary: document.getElementById('my-avatar-summary'),
		myUsernameSummary: document.getElementById('my-username-summary'),
		manageBlocksButton: document.getElementById('manage-blocks-button'),
		themeToggleButton: document.getElementById('theme-toggle-button'),
		logoutButton: document.getElementById('logout-button'),
		conversationSearch: document.getElementById('conversation-search'),
		conversationSearchProxy: document.getElementById('conversation-search-proxy'),
		conversationListArea: document.getElementById('conversation-list-area'),
		conversationListPlaceholder: document.getElementById('conversation-list-placeholder'),
		rightPanel: document.querySelector('.right-panel'),
		chatViewPlaceholder: document.getElementById('chat-view-placeholder'),
		chatViewContent: document.getElementById('chat-view-content'),
		chatViewHeader: document.getElementById('chat-view-header'),
		mobileMenuToggle: document.getElementById('mobile-menu-toggle'),
		mobilePlaceholderMenuToggle: document.getElementById('mobile-placeholder-menu-toggle'),
		chatPartnerAvatar: document.getElementById('chat-partner-avatar'),
		chatPartnerName: document.getElementById('chat-partner-name'),
		chatPartnerStatus: document.getElementById('chat-partner-status'),
		chatPartnerStatusText: document.getElementById('chat-partner-status-text'),
		chatTypingIndicator: document.getElementById('chat-typing-indicator'),
		blockUserButton: document.getElementById('block-user-button'),
		refreshMessagesButton: document.getElementById('refresh-messages-button'),
		messageArea: document.getElementById('message-area'),
		manualLoadOlderButton: document.getElementById('manual-load-older-button'),
		olderMessagesLoader: document.getElementById('older-messages-loader'),
		replyContextArea: document.getElementById('reply-context-area'),
		replyContextUser: document.getElementById('reply-context-user'),
		replyContextText: document.getElementById('reply-context-text'),
		cancelReplyButton: document.getElementById('cancel-reply-button'),
		messageInput: document.getElementById('message-input'),
		messageInputProxy: document.getElementById('message-input-proxy'),
		sendButton: document.getElementById('send-button'),
		emojiToggleButton: document.getElementById('emoji-toggle-button'),
		emojiPanel: document.getElementById('emoji-panel'),
		emojiGrid: document.querySelector('#emoji-panel .emoji-grid'),
		adminUsernameDisplay: document.getElementById('admin-username-display'),
		adminThemeToggleButton: document.getElementById('admin-theme-toggle-button'),
		adminLogoutButton: document.getElementById('admin-logout-button'),
		statTotalUsers: document.getElementById('stat-total-users'),
		statTotalMessages: document.getElementById('stat-total-messages'),
		statTotalConversations: document.getElementById('stat-total-conversations'),
		statActiveUsers: document.getElementById('stat-active-users'),
		adminUserError: document.getElementById('admin-user-error'),
		adminAddUserForm: document.getElementById('admin-add-user-form'),
		adminAddUsername: document.getElementById('admin-add-username'),
		adminAddUsernameProxy: document.getElementById('admin-add-username-proxy'),
		adminAddPassword: document.getElementById('admin-add-password'),
		adminAddPasswordProxy: document.getElementById('admin-add-password-proxy'),
		adminAddUserButton: document.getElementById('admin-add-user-button'),
		adminUserListBody: document.getElementById('admin-user-list-body'),
		manageBlocksModal: document.getElementById('manage-blocks-modal'),
		manageBlocksError: document.getElementById('manage-blocks-error'),
		blockedUsersList: document.getElementById('blocked-users-list'),
		blockedListPlaceholder: document.getElementById('blocked-list-placeholder'),
		modalCloseButtons: document.querySelectorAll('.modal-close-button'),
	};

	const COMMON_EMOJIS = ['😀', '😂', '❤️', '👍', '🤔', '😎', '🥳', '😊', '😇', '🥰', '😍', '🤩', '😘', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤫', '🤞', '💯', '🎉', '✨', '🔥', '👋', '🙏', '🤝', '👀', '😭', '😢', '😕', '🙁', '😬', '🙄', '🤢', '🤮', '👉', '👈', '👇', '👆'];

	const debounce = (func, wait) => { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; };
	const debouncedHandleScroll = debounce(handleMessageAreaScroll, 150);
	const showElement = (el) => { if (!el) return; const displayStyle = el.dataset.displayStyle || (el.tagName === 'SPAN' || el.tagName === 'I' || el.classList.contains('custom-button') ? 'inline-flex' : (el === dom.confirmationModalOverlay || el.classList.contains('modal-view')) ? 'flex' : 'flex'); el.style.display = displayStyle; };
	const hideElement = (el) => el && (el.style.display = 'none');

	const setButtonLoading = (buttonEl, isLoadingFlag) => {
		if (!buttonEl) return;
		if (isLoadingFlag) {
			buttonEl.classList.add('disabled');
			buttonEl.setAttribute('aria-disabled', 'true');
		} else {
			buttonEl.classList.remove('disabled');
			buttonEl.removeAttribute('aria-disabled');
		}
		const spinner = buttonEl.querySelector('.button-spinner');
		const text = buttonEl.querySelector('.button-text');
		const icon = buttonEl.querySelector('.button-icon');
		if (spinner) spinner.style.display = isLoadingFlag ? 'inline-block' : 'none';
		if (text) text.style.display = isLoadingFlag ? 'none' : 'inline-block';
		if (icon) {
			if (buttonEl.classList.contains('icon-button') || buttonEl.classList.contains('send-button')) {
				icon.style.display = isLoadingFlag ? 'none' : 'inline-flex';
			} else {
				icon.style.display = isLoadingFlag ? 'none' : 'inline-block';
			}
		}
	};

	const formatDate = (isoString) => {
		if (!isoString) return '';
		try {
			let date = new Date(isoString);
			return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
		} catch { return 'Invalid time'; }
	};
	const formatFullDateTime = (isoString) => {
		if (!isoString) return '';
		try {
			let date = new Date(isoString);
			return date.toLocaleString();
		} catch { return 'Invalid date'; }
	};
	function escapeHtml(unsafe) { return unsafe ? String(unsafe).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : ''; }
	function showError(message, duration = 5000) { if (!dom.errorBannerMessage || !dom.errorBanner) return; dom.errorBannerMessage.textContent = message || 'An unexpected error occurred.'; showElement(dom.errorBanner); dom.errorBanner.classList.add('show'); if (currentErrorTimeout) clearTimeout(currentErrorTimeout); currentErrorTimeout = setTimeout(hideError, duration); }
	function hideError() { if (!dom.errorBanner) return; dom.errorBanner.classList.remove('show'); setTimeout(() => { if (!dom.errorBanner.classList.contains('show')) hideElement(dom.errorBanner); }, 300); }
	function showConfirmation(message) { return new Promise((resolve) => { if (!dom.confirmationModalOverlay || !dom.confirmationMessage || !dom.confirmNoButton || !dom.confirmYesButton) { resolve(false); return; } dom.confirmationMessage.textContent = message; showElement(dom.confirmationModalOverlay); confirmationResolver = resolve; dom.confirmNoButton.focus(); }); }
	function handleConfirmation(result) { if (!dom.confirmationModalOverlay) return; hideElement(dom.confirmationModalOverlay); if (confirmationResolver) { confirmationResolver(result); confirmationResolver = null; } }
	function scrollToBottom(element, immediate = false) { if (!element) return; requestAnimationFrame(() => { element.scrollTo({ top: element.scrollHeight, behavior: immediate ? 'instant' : 'smooth' }); }); }
	function adjustTextareaHeight(textareaProxy = dom.messageInputProxy) {
		if (!textareaProxy || textareaProxy.contentEditable !== 'true') return;
		textareaProxy.style.height = 'auto';
		const scrollHeight = textareaProxy.scrollHeight;
		let maxHeight = 120;
		if (textareaProxy.classList.contains('edit-input-contenteditable')) maxHeight = 80;
		let baseHeight = parseFloat(getComputedStyle(textareaProxy).getPropertyValue('min-height')) || 48;
		textareaProxy.style.height = `${Math.max(baseHeight, Math.min(scrollHeight, maxHeight))}px`;
	}
	function updateSendButtonState() {
		if (!dom.sendButton) return;
		const canSend = !appState.isLoading.sendingMessage;
		if (canSend) {
			dom.sendButton.classList.remove('disabled');
			dom.sendButton.removeAttribute('aria-disabled');
		} else {
			dom.sendButton.classList.add('disabled');
			dom.sendButton.setAttribute('aria-disabled', 'true');
		}
	}
	const isMobileView = () => window.innerWidth <= MOBILE_BREAKPOINT;
	const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;

	function formatLastSeen(isoString, isOnline) {
		if (isOnline) return 'Online';
		if (!isoString) return 'Offline';
		try {
			const lastActiveDateUTC = new Date(isoString);
			const displayDate = lastActiveDateUTC; // Use UTC date for comparisons and formatting to local
			const currentDeviceTime = new Date();
			const diffSeconds = (currentDeviceTime.getTime() - lastActiveDateUTC.getTime()) / 1000;

			if (diffSeconds < 0 && Math.abs(diffSeconds) > 5 * 60) { return 'Offline'; }
			if (diffSeconds < 60) return `Active: just now`;
			const diffMinutes = Math.round(diffSeconds / 60);
			if (diffMinutes < 60) return `Active: ${diffMinutes}m ago`;

			const displayDateDateOnly = new Date(displayDate.getFullYear(), displayDate.getMonth(), displayDate.getDate());
			const currentDeviceDateOnly = new Date(currentDeviceTime.getFullYear(), currentDeviceTime.getMonth(), currentDeviceTime.getDate());

			if (currentDeviceDateOnly.getTime() === displayDateDateOnly.getTime()) {
				return `Active today at ${displayDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
			}
			const yesterdayDevice = new Date(currentDeviceTime);
			yesterdayDevice.setDate(currentDeviceTime.getDate() - 1);
			const yesterdayDeviceDateOnly = new Date(yesterdayDevice.getFullYear(), yesterdayDevice.getMonth(), yesterdayDevice.getDate());

			if (yesterdayDeviceDateOnly.getTime() === displayDateDateOnly.getTime()) {
				return `Active yesterday at ${displayDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
			}
			return `Active: ${displayDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
		} catch (e) { console.error("Error formatting last seen: ", e); return 'Offline (error)'; }
	}

	function applyTheme(theme) { dom.html.dataset.theme = theme; localStorage.setItem(THEME_STORAGE_KEY, theme); updateThemeIcons(theme); }
	function updateThemeIcons(theme) { const iconClass = theme === 'dark' ? 'fa-moon' : 'fa-sun'; const removeClass = theme === 'dark' ? 'fa-sun' : 'fa-moon';[dom.themeToggleButton, dom.adminThemeToggleButton].forEach((buttonEl) => { const icon = buttonEl?.querySelector('i.button-icon'); if (icon) { icon.classList.remove(removeClass); icon.classList.add(iconClass); } }); }
	function getInitialTheme() { const savedTheme = localStorage.getItem(THEME_STORAGE_KEY); if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme; return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'; }
	function handleThemeToggle() { const currentTheme = dom.html.dataset.theme || 'dark'; applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

	async function apiCall(endpoint, method = 'GET', body = null) {
		const url = `${API_BASE_URL}${endpoint}`;
		const headers = { 'Content-Type': 'application/json' };
		if (appState.currentUser?.token) { headers['Authorization'] = `Bearer ${appState.currentUser.token}`; }
		const options = { method, headers };
		if (body && method !== 'GET' && method !== 'HEAD') { options.body = JSON.stringify(body); }
		try {
			const response = await fetch(url, options);
			let responseData = null; const contentType = response.headers.get('content-type');
			if (response.status === 204) { return { success: true }; }
			if (contentType?.includes('application/json')) { try { responseData = await response.json(); } catch (e) { console.error(`[API] Invalid JSON from ${endpoint} (status ${response.status}):`, e); if (response.ok) return { success: true, warning: 'Invalid JSON body.' }; throw new Error(`Invalid JSON (status ${response.status})`); } }
			else { if (!response.ok) { const errorText = await response.text(); const error = new Error(errorText || `HTTP error ${response.status}`); error.status = response.status; throw error; } return { success: true, data: await response.text() }; }
			if (!response.ok) { const errorMessage = responseData?.error || `API Error ${response.status}`; const error = new Error(errorMessage); error.status = response.status; error.data = responseData; throw error; }
			return responseData;
		} catch (error) {
			const status = error.status || 'Network'; console.error(`[API] ${method} ${endpoint} FAILED (Status: ${status}):`, error.message, error.data || '');
			if (status === 401 && appState.currentView !== 'login' && appState.currentView !== 'onboarding') { showError('Your session has expired.'); logout(); }
			else if (status !== 401 || (appState.currentView !== 'login' && appState.currentView !== 'onboarding')) { showError(`Error: ${error.message || 'API error occurred.'}`); }
			throw error;
		}
	}

	function setState(newState) { Object.assign(appState, newState); }
	function switchView(newView) {
		console.log(`[View] Switching from ${appState.currentView} -> ${newView}`);
		if (appState.currentView === 'chat' || appState.currentView === 'admin') {
			if (messagePollingInterval) clearInterval(messagePollingInterval); messagePollingInterval = null;
			if (statusUpdateInterval) clearInterval(statusUpdateInterval); statusUpdateInterval = null;
		}
		if (appState.currentView === 'chat') {
			if (dom.messageArea) {
				dom.messageArea.removeEventListener('scroll', debouncedHandleScroll);
				dom.messageArea.removeEventListener('touchstart', handleTouchStart);
				dom.messageArea.removeEventListener('touchmove', handleTouchMove);
				dom.messageArea.removeEventListener('touchend', handleTouchEnd);
			}
		}
		hideElement(dom.loadingScreen);
		hideElement(dom.onboardingScreen);
		hideElement(dom.loginScreen);
		hideElement(dom.chatAppScreen);
		hideElement(dom.adminDashboardScreen);
		hideElement(dom.manageBlocksModal);
		hideElement(dom.confirmationModalOverlay);
		hideElement(dom.emojiPanel);
		switch (newView) {
			case 'loading': showElement(dom.loadingScreen); break;
			case 'onboarding': showElement(dom.onboardingScreen); dom.onboardingUsernameProxy?.focus(); break;
			case 'login': showElement(dom.loginScreen); showAdminLoginForm(); break;
			case 'chat': showElement(dom.chatAppScreen); break;
			case 'admin': showElement(dom.adminDashboardScreen); break;
		}
		setState({ currentView: newView });
		hideError();
		if (isMobileView()) dom.body.classList.remove('left-panel-active');
	}
	function setFormError(formName, message) { const errorElement = dom[`${formName}Error`]; if (errorElement) { errorElement.textContent = message || ''; errorElement.style.display = message ? 'block' : 'none'; errorElement.style.color = message && message.includes('success') ? 'var(--color-success)' : 'var(--color-error)'; } setState({ formErrors: { ...appState.formErrors, [formName]: message } }); }

	const EMOJI_REGEX_CHECK = /^(?:[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}️?]){1,3}$/u;

	function renderConversationList() {
		if (!dom.conversationListArea || !appState.currentUser) return;
		dom.conversationListArea.innerHTML = '';
		if (appState.isLoading.conversations || appState.isLoading.users) { dom.conversationListArea.innerHTML = `<div class="list-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`; return; }
		const searchTerm = dom.conversationSearch?.value.toLowerCase() || '';
		const allRenderableItems = [];
		const renderedUserIds = new Set();
		try {
			appState.conversations.forEach((convo) => {
				if (!convo || !convo.partner_id) return;
				const partnerUsername = convo.partner_username || 'Unknown User';
				if (searchTerm && !partnerUsername.toLowerCase().includes(searchTerm)) return;
				const lastActive = convo.partner_last_active_ts;
				const isPartnerOnline = lastActive && (new Date() - new Date(lastActive)) < ONLINE_THRESHOLD_MINUTES * 60 * 1000;
				const escapedName = escapeHtml(partnerUsername);
				const escapedSender = escapeHtml(convo.last_message_sender);
				const escapedContent = escapeHtml(convo.last_message_content || 'No messages yet');
				const snippet = `${escapedSender === appState.currentUser.username ? 'You: ' : ''}${escapedContent}`;
				allRenderableItems.push({ type: 'conversation', id: convo.id, partnerId: convo.partner_id, partnerUsername: escapedName, lastActiveTs: lastActive, lastActivityTs: convo.last_activity_ts || convo.last_message_ts, isOnline: isPartnerOnline, snippet: snippet, timestamp: convo.last_message_ts || convo.last_activity_ts, unreadCount: convo.unread_count || 0 });
				renderedUserIds.add(convo.partner_id);
			});
			appState.users.forEach((user) => {
				if (user.id === appState.currentUser.id || renderedUserIds.has(user.id) || appState.blockedUsers.some((b) => b.id === user.id)) return;
				const username = user.username || 'Unknown User';
				if (searchTerm && !username.toLowerCase().includes(searchTerm)) return;
				const lastActive = user.last_active_ts;
				const isOnline = lastActive && (new Date() - new Date(lastActive)) < ONLINE_THRESHOLD_MINUTES * 60 * 1000;
				allRenderableItems.push({ type: 'user', id: user.id, partnerId: user.id, partnerUsername: escapeHtml(username), lastActiveTs: lastActive, lastActivityTs: lastActive, isOnline: isOnline, snippet: 'Click to start chat', timestamp: null, unreadCount: 0 });
			});
			allRenderableItems.sort((a, b) => {
				const aIsActive = a.type === 'conversation' && a.id === appState.currentConversationId;
				const bIsActive = b.type === 'conversation' && b.id === appState.currentConversationId;
				if (aIsActive && !bIsActive) return -1;
				if (!aIsActive && bIsActive) return 1;
				if (a.type === 'conversation' && b.type === 'conversation') { const timeA = a.lastActivityTs ? new Date(a.lastActivityTs).getTime() : 0; const timeB = b.lastActivityTs ? new Date(b.lastActivityTs).getTime() : 0; return timeB - timeA; }
				if (a.type === 'user' && b.type === 'user') { return a.partnerUsername.localeCompare(b.partnerUsername); }
				if (a.type === 'conversation' && b.type === 'user') return -1;
				if (a.type === 'user' && b.type === 'conversation') return 1;
				return 0;
			});
			if (allRenderableItems.length === 0) { dom.conversationListArea.innerHTML = `<div class="list-placeholder">${searchTerm ? 'No matching chats or users found.' : 'No conversations or users available.'}</div>`; return; }
			let addedUserHeader = false;
			allRenderableItems.forEach((itemData) => {
				const item = document.createElement('div');
				item.classList.add('conversation-item');
				item.dataset.partnerId = String(itemData.partnerId);
				const avatarClass = itemData.isOnline ? 'online' : 'offline';
				const avatarIcon = 'fa-user';
				let itemHTML = '';
				if (itemData.type === 'conversation') {
					item.dataset.conversationId = String(itemData.id);
					if (itemData.id === appState.currentConversationId) item.classList.add('active');
					itemHTML = `<div class="avatar avatar-small ${avatarClass}" data-user-id="${itemData.partnerId}"><i class="fa-solid ${avatarIcon}"></i></div><div class="conversation-details"><span class="conversation-name">${itemData.partnerUsername}</span><span class="conversation-snippet">${itemData.snippet}</span></div><div class="conversation-meta">${itemData.timestamp ? `<span class="conversation-timestamp">${formatDate(itemData.timestamp)}</span>` : ''}${itemData.unreadCount > 0 ? '<div class="unread-indicator" title="Unread messages"></div>' : ''}</div>`;
					item.addEventListener('click', () => selectConversation(itemData.id));
				} else {
					const hasConversations = appState.conversations.some(c => !searchTerm || (c.partner_username || '').toLowerCase().includes(searchTerm));
					if (!addedUserHeader && allRenderableItems.filter(i => i.type === 'user').length > 0) { const userHeader = document.createElement('p'); userHeader.textContent = 'Start New Chat'; userHeader.className = 'list-separator-header'; dom.conversationListArea.appendChild(userHeader); addedUserHeader = true; }
					item.classList.add('user-list-item');
					item.dataset.userId = String(itemData.id);
					itemHTML = `<div class="avatar avatar-small ${avatarClass}" data-user-id="${itemData.id}"><i class="fa-solid ${avatarIcon}"></i></div><div class="conversation-details"><span class="conversation-name">${itemData.partnerUsername}</span><span class="conversation-snippet">${itemData.snippet}</span></div>`;
					item.addEventListener('click', () => handleStartNewConversation(itemData.id));
				}
				item.innerHTML = itemHTML;
				dom.conversationListArea.appendChild(item);
			});
		} catch (error) { console.error("[Render] renderConversationList - Error:", error); dom.conversationListArea.innerHTML = `<div class="list-placeholder error">Error displaying list.</div>`; }
	}
	function renderMessages(conversationId) {
		appState.lastMessageSenderIdMap.set(conversationId, null);
		appState.lastMessageTimestampMap.set(conversationId, null);
		try {
			const manualButton = dom.manualLoadOlderButton && dom.messageArea.contains(dom.manualLoadOlderButton) ? dom.manualLoadOlderButton : null;
			const olderLoader = dom.olderMessagesLoader && dom.messageArea.contains(dom.olderMessagesLoader) ? dom.olderMessagesLoader : null;

			dom.messageArea.innerHTML = '';

			if (manualButton) dom.messageArea.appendChild(manualButton);
			if (olderLoader) dom.messageArea.appendChild(olderLoader);

			const currentMessages = appState.messages.get(conversationId) || [];
			const placeholderId = `messages-placeholder-${conversationId}`;
			if (appState.isLoading.messages && currentMessages.length === 0) {
				const loadingPlaceholder = document.createElement('div');
				loadingPlaceholder.className = 'message-placeholder-style'; loadingPlaceholder.id = placeholderId;
				loadingPlaceholder.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading messages...`;
				dom.messageArea.appendChild(loadingPlaceholder); return;
			}
			if (!appState.isLoading.messages && !appState.isLoading.olderMessages && currentMessages.length === 0) {
				const noMessagesPlaceholder = document.createElement('div');
				noMessagesPlaceholder.className = 'message-placeholder-style'; noMessagesPlaceholder.id = placeholderId;
				noMessagesPlaceholder.textContent = 'No messages yet. Send an aura wave!';
				dom.messageArea.appendChild(noMessagesPlaceholder); return;
			}

			currentMessages.forEach(msg => addMessageToUI(msg, false));

			const startMarkerId = `start-marker-${conversationId}`;
			const existingStartMarker = dom.messageArea.querySelector(`#${startMarkerId}`);
			if (appState.hasReachedOldestMessage.get(conversationId) && currentMessages.length > 0 && !existingStartMarker) {
				const startMarker = document.createElement('div');
				startMarker.className = 'conversation-start-marker'; startMarker.id = startMarkerId;
				startMarker.textContent = 'Beginning of conversation';
				let firstMessageEl = dom.messageArea.querySelector('.message');
				if (firstMessageEl) {
					dom.messageArea.insertBefore(startMarker, firstMessageEl);
				} else {
					dom.messageArea.appendChild(startMarker);
				}
			} else if (!appState.hasReachedOldestMessage.get(conversationId) && existingStartMarker) {
				existingStartMarker.remove();
			}
			updateManualLoadButtonVisibility();
		} catch (error) { console.error("[Render] renderMessages - Error:", error); dom.messageArea.innerHTML = `<div class="message-placeholder-style error">Error displaying messages.</div>`; }
	}
	function addMessageToUI(msg, prepend = false, anchorNodeForPrepend = null) {
		if (!dom.messageArea || !appState.currentUser || !msg || !msg.id) { return; };
		const conversationId = msg.conversation_id;
		const lastSenderId = appState.lastMessageSenderIdMap.get(conversationId);
		const lastTimestamp = appState.lastMessageTimestampMap.get(conversationId);
		const currentTimestamp = new Date(msg.timestamp);
		let showTimeGapMarker = false;
		if (lastTimestamp && !prepend) {
			const timeDiff = currentTimestamp.getTime() - new Date(lastTimestamp).getTime();
			if (currentTimestamp.toDateString() !== new Date(lastTimestamp).toDateString() ||
				(msg.sender_id === lastSenderId && timeDiff > TIME_GAP_THRESHOLD_MINUTES * 60 * 1000)) {
				showTimeGapMarker = true;
			}
		} else if (!lastTimestamp && !prepend) {
			showTimeGapMarker = true;
		}

		const isConsecutive = !prepend && lastTimestamp && (currentTimestamp.getTime() - new Date(lastTimestamp).getTime() < CONSECUTIVE_MESSAGE_THRESHOLD_MS);

		if (showTimeGapMarker && !prepend) {
			const marker = document.createElement('div');
			marker.className = 'message-time-gap-marker';
			const dateObj = new Date(msg.timestamp);
			const dayName = dateObj.toLocaleDateString(undefined, { weekday: 'long' });
			const timeString = dateObj.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
			marker.textContent = `${dayName}, ${timeString}`;
			dom.messageArea.appendChild(marker);
		}

		const existingElement = dom.messageArea.querySelector(`.message[data-message-id="${msg.id}"]`);
		const isMyMessage = msg.sender_id === appState.currentUser.id;

		if (existingElement) {
			if (msg.is_edited && existingElement.dataset.timestamp !== msg.edited_at) { const contentSpan = existingElement.querySelector('.message-content'); if (contentSpan) contentSpan.innerHTML = `${escapeHtml(msg.content)} <span class="edited-indicator">(edited)</span>`; existingElement.dataset.timestamp = msg.edited_at; }
			if (isMyMessage && !msg.isOptimistic) { const currentReadStatus = existingElement.querySelector('.message-read-status.read-indicator') !== null; if (msg.isReadByPartner !== undefined && msg.isReadByPartner !== currentReadStatus) { updateMessageReadStatusUI(existingElement, msg.isReadByPartner); } }
			if (msg.isOptimistic === false && existingElement.classList.contains('sending')) {
				existingElement.classList.remove('sending');
				const actionsContainer = existingElement.querySelector('.message-actions');
				if (actionsContainer) { actionsContainer.innerHTML = `<button class="message-action-button reply-button" title="Reply"><i class="fa-solid fa-reply"></i></button>${isMyMessage ? '<button class="message-action-button edit-button" title="Edit"><i class="fa-solid fa-pencil"></i></button>' : ''}${isMyMessage ? '<button class="message-action-button delete-button" title="Delete Message"><i class="fa-solid fa-trash-can"></i></button>' : ''}`; attachMessageActionListeners(existingElement, msg); }
				if (isMyMessage && !existingElement.querySelector('.message-read-status')) { const metaDiv = existingElement.querySelector('.message-meta'); const readStatusSpan = document.createElement('span'); readStatusSpan.className = 'message-read-status'; readStatusSpan.setAttribute('aria-label', 'Message status'); metaDiv?.appendChild(readStatusSpan); updateMessageReadStatusUI(existingElement, msg.isReadByPartner || false); }
			} return;
		}

		const messageDiv = document.createElement('div');
		messageDiv.classList.add('message');
		if (isConsecutive && !showTimeGapMarker) messageDiv.classList.add('message-consecutive');
		messageDiv.dataset.messageId = String(msg.id);
		messageDiv.dataset.senderId = String(msg.sender_id);
		messageDiv.dataset.timestamp = msg.edited_at || msg.timestamp;
		messageDiv.classList.add(isMyMessage ? 'sent' : 'received');
		if (msg.isOptimistic) messageDiv.classList.add('sending');

		const isEmojiOnly = EMOJI_REGEX_CHECK.test(msg.content);
		if (isEmojiOnly) messageDiv.classList.add('message-emoji-only');

		let replyHTML = '';
		if (msg.reply_to_message_id) { const originalMsg = appState.messages.get(msg.conversation_id)?.find((m) => m.id === msg.reply_to_message_id); const originalSender = escapeHtml(msg.reply_sender_username || originalMsg?.sender_username || 'User'); const snippetText = escapeHtml(msg.reply_snippet || originalMsg?.content?.substring(0, 100) || 'Original message'); replyHTML = `<div class="reply-snippet" data-reply-to-id="${msg.reply_to_message_id}" title="Original: ${escapeHtml(msg.reply_snippet || originalMsg?.content || '')}"><strong class="reply-snippet-sender">${originalSender}</strong><span class="reply-snippet-text">${snippetText}</span></div>`; }

		const editedIndicatorHTML = msg.is_edited ? ' <span class="edited-indicator">(edited)</span>' : '';
		const messageContentHTML = `<span class="message-content">${escapeHtml(msg.content)}</span>`;
		const readStatusHTML = (isMyMessage && !msg.isOptimistic) ? '<span class="message-read-status" aria-label="Message status"></span>' : '';
		const actionsHTML = !msg.isOptimistic ? `<div class="message-actions"><button class="message-action-button reply-button" title="Reply"><i class="fa-solid fa-reply"></i></button>${isMyMessage ? '<button class="message-action-button edit-button" title="Edit"><i class="fa-solid fa-pencil"></i></button>' : ''}${isMyMessage ? '<button class="message-action-button delete-button" title="Delete Message"><i class="fa-solid fa-trash-can"></i></button>' : ''}</div>` : '<div class="message-actions"></div>';
		messageDiv.innerHTML = `${replyHTML}${messageContentHTML}<div class="message-meta"><span class="message-timestamp">${formatDate(msg.timestamp)}</span>${editedIndicatorHTML}${readStatusHTML}</div>${actionsHTML}`;

		if (isEmojiOnly) {
			const metaDiv = messageDiv.querySelector('.message-meta');
			const replySnippetDiv = messageDiv.querySelector('.reply-snippet');
			const actionsDiv = messageDiv.querySelector('.message-actions');
			if (metaDiv) metaDiv.style.setProperty('display', 'flex', 'important');
			if (replySnippetDiv) replySnippetDiv.style.setProperty('display', 'block', 'important');
			if (actionsDiv) actionsDiv.style.setProperty('display', 'flex', 'important');
		}

		if (!msg.isOptimistic) { attachMessageActionListeners(messageDiv, msg); }
		const replySnippetEl = messageDiv.querySelector('.reply-snippet');
		if (replySnippetEl) { replySnippetEl.addEventListener('click', (e) => { e.stopPropagation(); const targetMessageId = replySnippetEl.dataset.replyToId; scrollToMessage(targetMessageId); }); }
		if (isMyMessage && !msg.isOptimistic) { updateMessageReadStatusUI(messageDiv, msg.isReadByPartner || false); }

		const placeholder = dom.messageArea?.querySelector('.message-placeholder-style');
		if (placeholder && !msg.isOptimistic) placeholder.remove();

		if (prepend) {
			if (anchorNodeForPrepend) {
				dom.messageArea.insertBefore(messageDiv, anchorNodeForPrepend);
			} else {
				let actualFirstChild = dom.messageArea.firstChild;
				while (actualFirstChild && (actualFirstChild === dom.manualLoadOlderButton || actualFirstChild === dom.olderMessagesLoader)) {
					actualFirstChild = actualFirstChild.nextSibling;
				}
				if (actualFirstChild) {
					dom.messageArea.insertBefore(messageDiv, actualFirstChild);
				} else {
					dom.messageArea.appendChild(messageDiv); // Fallback if only loaders were present
				}
			}
		} else {
			dom.messageArea.appendChild(messageDiv);
			appState.lastMessageSenderIdMap.set(conversationId, msg.sender_id);
			appState.lastMessageTimestampMap.set(conversationId, msg.timestamp);
		}
	}
	function attachMessageActionListeners(messageDiv, msg) {
		const replyBtn = messageDiv.querySelector('.reply-button');
		const editBtn = messageDiv.querySelector('.edit-button');
		const deleteBtn = messageDiv.querySelector('.delete-button');
		if (replyBtn) { replyBtn.replaceWith(replyBtn.cloneNode(true)); messageDiv.querySelector('.reply-button').addEventListener('click', (e) => { e.stopPropagation(); handleReplyClick(msg.id, msg.sender_username || 'User', msg.content); }); }
		if (editBtn) { editBtn.replaceWith(editBtn.cloneNode(true)); messageDiv.querySelector('.edit-button').addEventListener('click', (e) => { e.stopPropagation(); handleShowEditInput(messageDiv, msg.id, msg.content); }); }
		if (deleteBtn) { deleteBtn.replaceWith(deleteBtn.cloneNode(true)); messageDiv.querySelector('.delete-button').addEventListener('click', (e) => { e.stopPropagation(); handleDeleteMessage(msg.conversation_id, msg.id, messageDiv); }); }
	}
	function updateMessageReadStatusUI(messageElement, isReadByPartner) {
		const statusElement = messageElement?.querySelector('.message-read-status');
		if (!statusElement || !messageElement.classList.contains('sent')) return;
		statusElement.classList.remove('sent-indicator', 'read-indicator');
		if (isReadByPartner) { statusElement.innerHTML = '<i class="fa-solid fa-check-double" title="Read"></i>'; statusElement.classList.add('read-indicator'); statusElement.setAttribute('aria-label', 'Message read'); } else { statusElement.innerHTML = '<i class="fa-solid fa-check" title="Sent"></i>'; statusElement.classList.add('sent-indicator'); statusElement.setAttribute('aria-label', 'Message sent'); }
	}
	function removeOptimisticMessage(tempId) { const messageElement = dom.messageArea?.querySelector(`.message.sending[data-message-id="${tempId}"]`); if (messageElement) { messageElement.remove(); if (dom.messageArea?.querySelectorAll('.message').length === 0 && !appState.isLoading.messages && !appState.isLoading.olderMessages) { renderMessages(appState.currentConversationId); } } }
	function updateOptimisticMessage(tempId, confirmedMessage) {
		if (!dom.messageArea || !confirmedMessage) return;
		const messageElement = dom.messageArea?.querySelector(`.message.sending[data-message-id="${tempId}"]`);
		if (messageElement) {
			messageElement.dataset.messageId = String(confirmedMessage.id);
			messageElement.dataset.timestamp = confirmedMessage.edited_at || confirmedMessage.timestamp;
			messageElement.classList.remove('sending');
			const actionsContainer = messageElement.querySelector('.message-actions');
			if (actionsContainer) { actionsContainer.innerHTML = `<button class="message-action-button reply-button" title="Reply"><i class="fa-solid fa-reply"></i></button>${confirmedMessage.sender_id === appState.currentUser?.id ? '<button class="message-action-button edit-button" title="Edit"><i class="fa-solid fa-pencil"></i></button>' : ''}${confirmedMessage.sender_id === appState.currentUser?.id ? '<button class="message-action-button delete-button" title="Delete Message"><i class="fa-solid fa-trash-can"></i></button>' : ''}`; attachMessageActionListeners(messageElement, confirmedMessage); }
			if (confirmedMessage.sender_id === appState.currentUser?.id && !messageElement.querySelector('.message-read-status')) { const metaDiv = messageElement.querySelector('.message-meta'); const readStatusSpan = document.createElement('span'); readStatusSpan.className = 'message-read-status'; readStatusSpan.setAttribute('aria-label', 'Message status'); metaDiv?.appendChild(readStatusSpan); updateMessageReadStatusUI(messageElement, false); }
		}
	}
	function removeMessageUI(conversationId, messageId) { if (conversationId !== appState.currentConversationId || !dom.messageArea) return; const messageElement = dom.messageArea.querySelector(`.message[data-message-id="${messageId}"]`); if (messageElement) { messageElement.remove(); if (dom.messageArea.querySelectorAll('.message').length === 0 && !appState.isLoading.messages && !appState.isLoading.olderMessages) { renderMessages(conversationId); } } }
	function updateChatHeader(conversation) {
		if (!conversation || !dom.chatViewHeader || !dom.chatPartnerName || !dom.chatPartnerAvatar || !dom.chatPartnerStatus || !dom.chatPartnerStatusText || !dom.blockUserButton || !dom.refreshMessagesButton) { clearChatView(); return; }
		const name = conversation.partner_username || 'Unknown User';
		const partnerId = conversation.partner_id;
		const lastActive = conversation.partner_last_active_ts;
		dom.chatViewHeader.dataset.conversationId = String(conversation.id);
		dom.chatViewHeader.dataset.userId = String(partnerId || '');
		dom.chatPartnerName.textContent = escapeHtml(name);
		dom.chatPartnerAvatar.querySelector('i').className = `fa-solid fa-user`;
		dom.chatPartnerAvatar.classList.remove('group');
		dom.chatPartnerAvatar.dataset.userId = String(partnerId || '');
		const isOnline = lastActive && (new Date() - new Date(lastActive)) < ONLINE_THRESHOLD_MINUTES * 60 * 1000;
		const statusString = formatLastSeen(lastActive, isOnline);
		dom.chatPartnerStatus.dataset.lastActiveTs = lastActive || '';
		dom.chatPartnerStatusText.textContent = statusString;
		dom.chatPartnerStatus.classList.toggle('online', isOnline);
		dom.chatPartnerStatus.classList.toggle('offline', !isOnline);
		dom.chatPartnerAvatar.classList.toggle('online', isOnline);
		dom.chatPartnerAvatar.classList.toggle('offline', !isOnline);
		hideElement(dom.chatTypingIndicator);
		showElement(dom.chatPartnerStatus);
		showElement(dom.refreshMessagesButton);
		dom.refreshMessagesButton.classList.remove('disabled');
		dom.refreshMessagesButton.removeAttribute('aria-disabled');
		if (partnerId && !appState.blockedUsers.some((b) => b.id === partnerId)) { showElement(dom.blockUserButton); dom.blockUserButton.dataset.userId = String(partnerId); dom.blockUserButton.title = `Block ${escapeHtml(name)}`; } else { hideElement(dom.blockUserButton); }
		enableChatInput(conversation);
	}
	function enableChatInput(conversation) {
		if (!dom.messageInputProxy || !dom.messageInput || !dom.sendButton) return;
		let shouldEnable = true;
		let placeholderText = 'Send an aura wave...';
		if (!conversation) { shouldEnable = false; placeholderText = 'Select a conversation'; }
		else if (conversation?.partner_id && appState.blockedUsers.some((u) => u.id === conversation.partner_id)) { shouldEnable = false; placeholderText = 'You have blocked this user.'; }
		dom.messageInputProxy.contentEditable = shouldEnable ? 'true' : 'false';
		dom.messageInputProxy.dataset.placeholder = placeholderText;
		dom.messageInput.disabled = !shouldEnable;
		updateSendButtonState();
		adjustTextareaHeight();
	}
	function clearChatView() {
		hideElement(dom.chatViewContent);
		showElement(dom.chatViewPlaceholder);
		if (messagePollingInterval) clearInterval(messagePollingInterval); messagePollingInterval = null;
		if (dom.messageArea) { dom.messageArea.removeEventListener('scroll', debouncedHandleScroll); dom.messageArea.removeEventListener('touchstart', handleTouchStart); dom.messageArea.removeEventListener('touchmove', handleTouchMove); dom.messageArea.removeEventListener('touchend', handleTouchEnd); }
		setState({ currentConversationId: null, isLoading: { ...appState.isLoading, messages: false, olderMessages: false } });
		appState.hasReachedOldestMessage.clear();
		appState.oldestMessageTimestamp.clear();
		appState.messages.clear();
		appState.lastMessageSenderIdMap.clear();
		appState.lastMessageTimestampMap.clear();
		if (dom.messageArea) dom.messageArea.innerHTML = '';
		if (dom.manualLoadOlderButton && !dom.messageArea.contains(dom.manualLoadOlderButton)) dom.messageArea.prepend(dom.manualLoadOlderButton);
		if (dom.olderMessagesLoader && !dom.messageArea.contains(dom.olderMessagesLoader)) {
			if (dom.manualLoadOlderButton) dom.manualLoadOlderButton.insertAdjacentElement('afterend', dom.olderMessagesLoader);
			else dom.messageArea.prepend(dom.olderMessagesLoader);
		}
		hideElement(dom.olderMessagesLoader);
		hideElement(dom.manualLoadOlderButton);

		cancelReply();
		cancelEdit();
		if (dom.messageInputProxy) { dom.messageInputProxy.textContent = ''; dom.messageInputProxy.contentEditable = 'false'; dom.messageInputProxy.dataset.placeholder = 'Select a conversation'; dom.messageInputProxy.classList.remove('has-content'); }
		if (dom.messageInput) { dom.messageInput.value = ''; dom.messageInput.disabled = true; }
		adjustTextareaHeight();
		updateSendButtonState();
		document.querySelectorAll('.conversation-item.active').forEach((el) => el.classList.remove('active'));
		if (dom.chatPartnerName) dom.chatPartnerName.textContent = 'Select Chat';
		if (dom.chatPartnerAvatar) { dom.chatPartnerAvatar.querySelector('i').className = 'fa-solid fa-user'; dom.chatPartnerAvatar.classList.remove('online', 'offline', 'group'); dom.chatPartnerAvatar.dataset.userId = ''; }
		if (dom.chatPartnerStatus) { dom.chatPartnerStatus.dataset.lastActiveTs = ''; hideElement(dom.chatPartnerStatus); }
		if (dom.chatViewHeader) { dom.chatViewHeader.dataset.conversationId = ''; dom.chatViewHeader.dataset.userId = ''; }
		hideElement(dom.blockUserButton);
		hideElement(dom.refreshMessagesButton);
		hideElement(dom.chatTypingIndicator);
		enableChatInput(null);
		hideElement(dom.emojiPanel);
		if (isMobileView()) dom.body.classList.remove('left-panel-active');
	}
	function renderAdminStats(stats = {}) { if (!dom.statTotalUsers || !dom.statTotalMessages || !dom.statTotalConversations || !dom.statActiveUsers) return; try { dom.statTotalUsers.textContent = String(stats.userCount ?? '--'); dom.statTotalMessages.textContent = String(stats.messageCount ?? '--'); dom.statTotalConversations.textContent = String(stats.conversationCount ?? '--'); dom.statActiveUsers.textContent = String(stats.activeUsers ?? '--'); } catch (error) { console.error("[Render] renderAdminStats - Error updating UI:", error); } }
	function renderAdminUserList(adminUsers = []) {
		if (!dom.adminUserListBody) return;
		dom.adminUserListBody.innerHTML = '';
		try {
			if (appState.isLoading.allUsersAdmin) { dom.adminUserListBody.innerHTML = `<tr><td colspan="4" class="list-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>`; return; }
			if (adminUsers.length === 0) { dom.adminUserListBody.innerHTML = `<tr><td colspan="4" class="list-placeholder">No users found.</td></tr>`; return; }
			adminUsers.forEach(user => {
				const row = document.createElement('tr');
				row.dataset.userId = String(user.id);
				const isOnline = user.last_active_ts && (new Date() - new Date(user.last_active_ts)) < ONLINE_THRESHOLD_MINUTES * 60 * 1000;
				row.innerHTML = `<td>${user.id}</td><td>${escapeHtml(user.username)}</td><td>${formatLastSeen(user.last_active_ts, isOnline)}</td><td><div role="button" tabindex="0" class="custom-button icon-button action-button delete-user-button" title="Delete User ${escapeHtml(user.username)}" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}"><i class="fa-solid fa-trash-can button-icon"></i></div></td>`;
				const deleteBtn = row.querySelector('.delete-user-button');
				if (deleteBtn) { deleteBtn.addEventListener('click', handleDeleteUserByAdmin); }
				dom.adminUserListBody.appendChild(row);
			});
		} catch (error) { console.error("[Render] renderAdminUserList - Error during rendering:", error); dom.adminUserListBody.innerHTML = `<tr><td colspan="4" class="list-placeholder error">Error displaying users.</td></tr>`; }
	}
	function renderBlockedUsersList() {
		if (!dom.blockedUsersList || !dom.manageBlocksModal) return;
		dom.blockedUsersList.innerHTML = '';
		const placeholder = dom.blockedListPlaceholder;
		if (placeholder) hideElement(placeholder);
		if (appState.isLoading.blockedUsers) { dom.blockedUsersList.innerHTML = `<p class="list-placeholder" id="blocked-list-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</p>`; return; }
		if (appState.blockedUsers.length === 0) { dom.blockedUsersList.innerHTML = `<p class="list-placeholder" id="blocked-list-placeholder">You haven't blocked anyone.</p>`; return; }
		appState.blockedUsers.forEach(user => {
			const item = document.createElement('div');
			item.className = 'blocked-user-item';
			item.dataset.userId = String(user.id);
			item.innerHTML = `<div class="blocked-user-info"><div class="avatar avatar-small offline"><i class="fa-solid fa-user"></i></div><span>${escapeHtml(user.username)}</span></div><div role="button" tabindex="0" class="custom-button unblock-button" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">Unblock</div>`;
			const unblockBtn = item.querySelector('.unblock-button');
			if (unblockBtn) { unblockBtn.addEventListener('click', handleUnblockUser); }
			dom.blockedUsersList.appendChild(item);
		});
	}
	function updateActiveStatusUI() {
		if (!appState.currentUser || appState.currentView === 'login' || appState.currentView === 'onboarding') return;
		const now = new Date();
		const onlineThreshold = ONLINE_THRESHOLD_MINUTES * 60 * 1000;
		if (dom.myAvatarSummary) { dom.myAvatarSummary.classList.remove('offline'); dom.myAvatarSummary.classList.add('online'); }
		document.querySelectorAll('.conversation-item .avatar[data-user-id]').forEach(avatar => {
			const userId = parseInt(avatar.dataset.userId, 10);
			if (!userId || isNaN(userId)) return;
			let userDataSource = null;
			if (appState.currentView === 'chat') { userDataSource = appState.conversations.find(c => c.partner_id === userId) || appState.users.find(u => u.id === userId); } else if (appState.currentView === 'admin') { userDataSource = appState.adminUserList.find(u => u.id === userId); }
			const lastActiveTs = userDataSource?.last_active_ts || userDataSource?.partner_last_active_ts;
			if (lastActiveTs) { const isOnline = (new Date() - new Date(lastActiveTs)) < onlineThreshold; avatar.classList.toggle('online', isOnline); avatar.classList.toggle('offline', !isOnline); } else { avatar.classList.remove('online'); avatar.classList.add('offline'); }
		});
		if (appState.currentView === 'chat' && appState.currentConversationId && dom.chatPartnerStatus && dom.chatPartnerAvatar) {
			const currentConvo = appState.conversations.find(c => c.id === appState.currentConversationId);
			const partnerId = currentConvo?.partner_id;
			const lastActiveTs = currentConvo?.partner_last_active_ts;
			if (partnerId) {
				const isOnline = lastActiveTs && (new Date() - new Date(lastActiveTs)) < onlineThreshold;
				const statusString = formatLastSeen(lastActiveTs, isOnline);
				dom.chatPartnerStatusText.textContent = statusString;
				dom.chatPartnerStatus.classList.toggle('online', isOnline);
				dom.chatPartnerStatus.classList.toggle('offline', !isOnline);
				dom.chatPartnerAvatar.classList.toggle('online', isOnline);
				dom.chatPartnerAvatar.classList.toggle('offline', !isOnline);
				dom.chatPartnerStatus.dataset.lastActiveTs = lastActiveTs || '';
			}
		}
		if (appState.currentView === 'admin' && dom.adminUserListBody) {
			document.querySelectorAll('#admin-user-list-body tr[data-user-id]').forEach(row => {
				const userId = parseInt(row.dataset.userId, 10);
				const user = appState.adminUserList.find(u => u.id === userId);
				if (user) {
					const lastActiveCell = row.cells[2];
					if (lastActiveCell) { const isOnline = user.last_active_ts && (new Date() - new Date(user.last_active_ts)) < onlineThreshold; lastActiveCell.textContent = formatLastSeen(user.last_active_ts, isOnline); }
				}
			});
		}
	}

	async function checkSetupStatus() { try { const response = await apiCall('/setup/status'); return response?.adminExists; } catch (error) { console.error("[Fetch] checkSetupStatus - Failed:", error.message); throw error; } }
	async function fetchChatData() {
		setState({ isLoading: { ...appState.isLoading, blockedUsers: true, conversations: true, users: true } });
		renderConversationList(); renderBlockedUsersList();
		let blockData = []; let convoData = []; let userData = [];
		try { blockData = await apiCall('/blocks'); if (!Array.isArray(blockData)) { blockData = []; } } catch (error) { console.error("[Fetch] Fetch blocks failed:", error.message); } finally { setState({ blockedUsers: blockData, isLoading: { ...appState.isLoading, blockedUsers: false } }); renderBlockedUsersList(); }
		try { convoData = await apiCall('/conversations'); if (!Array.isArray(convoData)) { convoData = []; } } catch (error) { console.error("[Fetch] Fetch conversations failed:", error.message); } finally { setState({ conversations: convoData, isLoading: { ...appState.isLoading, conversations: false } }); }
		try { userData = await apiCall('/users'); if (!Array.isArray(userData)) { userData = []; } } catch (error) { console.error("[Fetch] Fetch users failed:", error.message); } finally { setState({ users: userData, isLoading: { ...appState.isLoading, users: false } }); }
		if (dom.conversationSearchProxy) dom.conversationSearchProxy.textContent = ''; if (dom.conversationSearch) dom.conversationSearch.value = '';
		renderConversationList();
		updateActiveStatusUI();
	}
	async function fetchMessagesForConversation(conversationId, isManualRefresh = false) {
		if (appState.isLoading.messages || appState.currentView !== 'chat') return;
		setState({ isLoading: { ...appState.isLoading, messages: true, olderMessages: false } });
		appState.hasReachedOldestMessage.set(conversationId, false);
		appState.oldestMessageTimestamp.delete(conversationId);
		appState.messages.set(conversationId, []);
		if (isManualRefresh && dom.refreshMessagesButton) { setButtonLoading(dom.refreshMessagesButton, true); }
		renderMessages(conversationId);
		try {
			const fetchedMessages = await apiCall(`/conversations/${conversationId}/messages`);
			const sortedMessages = Array.isArray(fetchedMessages) ? fetchedMessages : [];
			appState.messages.set(conversationId, sortedMessages);
			if (sortedMessages.length > 0) { appState.oldestMessageTimestamp.set(conversationId, sortedMessages[0].timestamp); if (sortedMessages.length < MESSAGES_INITIAL_LOAD_LIMIT) { appState.hasReachedOldestMessage.set(conversationId, true); } } else { appState.hasReachedOldestMessage.set(conversationId, true); appState.oldestMessageTimestamp.set(conversationId, null); }
			markConversationAsRead(conversationId, fetchedMessages.filter(m => m.sender_id !== appState.currentUser?.id).map(m => m.id));
			const currentConvoData = appState.conversations.find(c => c.id === conversationId);
			if (currentConvoData) updateChatHeader(currentConvoData);
		} catch (error) { console.error(`[Fetch] fetchMessagesForConversation - Failed for ${conversationId}:`, error.message); appState.messages.set(conversationId, []); appState.hasReachedOldestMessage.set(conversationId, true); appState.oldestMessageTimestamp.set(conversationId, null); }
		finally {
			setState({ isLoading: { ...appState.isLoading, messages: false } });
			if (isManualRefresh && dom.refreshMessagesButton) { setButtonLoading(dom.refreshMessagesButton, false); }
			renderMessages(conversationId);
			requestAnimationFrame(() => { scrollToBottom(dom.messageArea, true); });
			if (dom.messageArea) { dom.messageArea.removeEventListener('scroll', debouncedHandleScroll); dom.messageArea.addEventListener('scroll', debouncedHandleScroll); }
			updateSendButtonState();
			updateManualLoadButtonVisibility();
		}
	}
	function updateManualLoadButtonVisibility() {
		if (!dom.manualLoadOlderButton || !appState.currentConversationId || !dom.messageArea) {
			if (dom.manualLoadOlderButton) hideElement(dom.manualLoadOlderButton);
			return;
		}
		const conversationId = appState.currentConversationId;
		const canLoadMore = !appState.hasReachedOldestMessage.get(conversationId);
		const notCurrentlyLoadingAnyMessages = !appState.isLoading.olderMessages && !appState.isLoading.messages;
		const isScrolledNearTop = dom.messageArea.scrollTop < MANUAL_BUTTON_SCROLL_THRESHOLD;

		if (canLoadMore && notCurrentlyLoadingAnyMessages && isScrolledNearTop) {
			showElement(dom.manualLoadOlderButton);
			setButtonLoading(dom.manualLoadOlderButton, false); // Ensure not in loading state
		} else {
			hideElement(dom.manualLoadOlderButton);
		}
	}
	async function fetchOlderMessages(conversationId, isManualClick = false) {
		if (appState.isLoading.olderMessages || appState.isLoading.messages || appState.hasReachedOldestMessage.get(conversationId)) {
			if (isManualClick && dom.manualLoadOlderButton) setButtonLoading(dom.manualLoadOlderButton, false);
			updateManualLoadButtonVisibility();
			return;
		}
		const beforeTs = appState.oldestMessageTimestamp.get(conversationId);
		if (!beforeTs) {
			appState.hasReachedOldestMessage.set(conversationId, true);
			if (isManualClick && dom.manualLoadOlderButton) setButtonLoading(dom.manualLoadOlderButton, false);
			updateManualLoadButtonVisibility();
			renderMessages(conversationId);
			return;
		}

		setState({ isLoading: { ...appState.isLoading, olderMessages: true } });
		if (isManualClick && dom.manualLoadOlderButton) {
			setButtonLoading(dom.manualLoadOlderButton, true);
			hideElement(dom.olderMessagesLoader);
		} else if (dom.olderMessagesLoader) {
			showElement(dom.olderMessagesLoader);
			if (dom.messageArea.firstChild !== dom.olderMessagesLoader && dom.messageArea.firstChild !== dom.manualLoadOlderButton) {
				dom.messageArea.prepend(dom.olderMessagesLoader);
			} else if (dom.manualLoadOlderButton && dom.messageArea.firstChild === dom.manualLoadOlderButton && dom.manualLoadOlderButton.nextSibling !== dom.olderMessagesLoader) {
				dom.manualLoadOlderButton.insertAdjacentElement('afterend', dom.olderMessagesLoader);
			} else if (dom.messageArea.firstChild !== dom.olderMessagesLoader) {
				dom.messageArea.prepend(dom.olderMessagesLoader);
			}

			hideElement(dom.manualLoadOlderButton);
		}

		const oldScrollHeight = dom.messageArea.scrollHeight;
		const oldScrollTop = dom.messageArea.scrollTop;

		try {
			const olderFetched = await apiCall(`/conversations/${conversationId}/messages?before_ts=${encodeURIComponent(beforeTs)}`);
			const newOlderMessages = Array.isArray(olderFetched) ? olderFetched : [];

			if (newOlderMessages.length > 0) {
				appState.oldestMessageTimestamp.set(conversationId, newOlderMessages[0].timestamp);
				const currentCached = appState.messages.get(conversationId) || [];
				appState.messages.set(conversationId, [...newOlderMessages, ...currentCached]);

				let currentFirstContent = dom.messageArea.querySelector('.message, .conversation-start-marker, .message-time-gap-marker');
				if (dom.olderMessagesLoader.nextSibling && (dom.olderMessagesLoader.nextSibling.classList.contains('message') || dom.olderMessagesLoader.nextSibling.classList.contains('conversation-start-marker') || dom.olderMessagesLoader.nextSibling.classList.contains('message-time-gap-marker'))) {
					currentFirstContent = dom.olderMessagesLoader.nextSibling;
				} else if (dom.manualLoadOlderButton.nextSibling && (dom.manualLoadOlderButton.nextSibling.classList.contains('message') || dom.manualLoadOlderButton.nextSibling.classList.contains('conversation-start-marker') || dom.manualLoadOlderButton.nextSibling.classList.contains('message-time-gap-marker'))) {
					currentFirstContent = dom.manualLoadOlderButton.nextSibling;
				}


				for (let i = newOlderMessages.length - 1; i >= 0; i--) {
					addMessageToUI(newOlderMessages[i], true, currentFirstContent);
				}

				requestAnimationFrame(() => { const newScrollHeight = dom.messageArea.scrollHeight; dom.messageArea.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight); });
				if (newOlderMessages.length < MESSAGES_LOAD_OLDER_LIMIT) {
					appState.hasReachedOldestMessage.set(conversationId, true);
					renderMessages(conversationId);
				}
			} else {
				appState.hasReachedOldestMessage.set(conversationId, true);
				appState.oldestMessageTimestamp.set(conversationId, null);
				renderMessages(conversationId);
			}
		} catch (error) {
			console.error(`[Fetch] fetchOlderMessages - Failed for ${conversationId}:`, error.message);
			appState.hasReachedOldestMessage.set(conversationId, true);
		}
		finally {
			setState({ isLoading: { ...appState.isLoading, olderMessages: false } });
			if (isManualClick && dom.manualLoadOlderButton) setButtonLoading(dom.manualLoadOlderButton, false);
			if (dom.olderMessagesLoader) hideElement(dom.olderMessagesLoader);
			updateManualLoadButtonVisibility();
			updateSendButtonState();
		}
	}
	async function fetchBlockedUsers() {
		if (appState.isLoading.blockedUsers && appState.currentView !== 'chat') return;
		setState({ isLoading: { ...appState.isLoading, blockedUsers: true } });
		renderBlockedUsersList();
		let blockedData = [];
		try { blockedData = await apiCall('/blocks'); if (!Array.isArray(blockedData)) { console.warn("[Fetch] Blocks not array:", blockedData); blockedData = []; } } catch (error) { console.error("[Fetch] Fetch blocks failed:", error.message); if (dom.manageBlocksError) setFormError('manageBlocks', `Failed to load: ${error.message}`); blockedData = []; }
		finally {
			setState({ blockedUsers: blockedData, isLoading: { ...appState.isLoading, blockedUsers: false } }); renderBlockedUsersList();
			if (appState.currentConversationId) { const currentConvo = appState.conversations.find(c => c.id === appState.currentConversationId); if (currentConvo) { updateChatHeader(currentConvo); enableChatInput(currentConvo); } }
			renderConversationList();
		}
	}
	async function fetchAdminStats() {
		if (appState.isLoading.adminStats && appState.currentView !== 'admin') return;
		setState({ isLoading: { ...appState.isLoading, adminStats: true } });
		let statsData = {};
		try { statsData = await apiCall('/admin/stats'); if (typeof statsData !== 'object' || statsData === null || Array.isArray(statsData)) { console.warn("fetchAdminStats: Received non-object:", statsData); statsData = {}; } } catch (error) { console.error("fetchAdminStats: Fetch failed:", error.message); statsData = {}; }
		finally { setState({ adminStats: statsData, isLoading: { ...appState.isLoading, adminStats: false } }); renderAdminStats(appState.adminStats); }
	}
	async function fetchAdminUsers() {
		if (appState.isLoading.allUsersAdmin && appState.currentView !== 'admin') return;
		setState({ isLoading: { ...appState.isLoading, allUsersAdmin: true } });
		renderAdminUserList();
		let usersData = [];
		try { usersData = await apiCall('/admin/users'); if (!Array.isArray(usersData)) { console.warn("fetchAdminUsers: Received non-array:", usersData); usersData = []; } } catch (error) { console.error("fetchAdminUsers: Fetch failed:", error.message); if (dom.adminUserError) setFormError('adminUser', `Failed to load users: ${error.message}`); usersData = []; }
		finally { setState({ adminUserList: usersData, isLoading: { ...appState.isLoading, allUsersAdmin: false } }); renderAdminUserList(appState.adminUserList); updateActiveStatusUI(); }
	}

	function startMessagePolling(conversationId) {
		if (messagePollingInterval) clearInterval(messagePollingInterval);
		if (appState.currentView !== 'chat') return;
		messagePollingInterval = setInterval(async () => { if (document.hidden || appState.currentView !== 'chat' || appState.currentConversationId !== conversationId || appState.isLoading.messages || appState.isLoading.olderMessages) { return; } await fetchNewMessages(conversationId); }, POLLING_INTERVAL_MS);
	}
	async function fetchNewMessages(conversationId) {
		if (appState.isLoading.messages || appState.isLoading.olderMessages) return;
		const currentMessages = appState.messages.get(conversationId) || [];
		const lastTimestamp = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].timestamp : null;
		if (!lastTimestamp) { if (messagePollingInterval) clearInterval(messagePollingInterval); messagePollingInterval = null; return; }
		try {
			const polledMessages = await apiCall(`/conversations/${conversationId}/messages?since=${encodeURIComponent(lastTimestamp)}`);
			if (polledMessages?.length > 0) {
				let existingMessages = appState.messages.get(conversationId) || [];
				let addedNew = false; let updatedExisting = false;
				const isNearBottom = dom.messageArea && dom.messageArea.scrollTop + dom.messageArea.clientHeight >= dom.messageArea.scrollHeight - 150;
				let partnerSentNew = false; let newMsgIdsForRead = [];
				polledMessages.forEach((msg) => {
					const messageIndex = existingMessages.findIndex((m) => m.id === msg.id);
					if (messageIndex === -1) { existingMessages.push(msg); addMessageToUI(msg, false); addedNew = true; if (msg.sender_id !== appState.currentUser.id) { partnerSentNew = true; newMsgIdsForRead.push(msg.id); } } else { const cachedMsg = existingMessages[messageIndex]; if (JSON.stringify(cachedMsg) !== JSON.stringify(msg)) { existingMessages[messageIndex] = msg; addMessageToUI(msg, false); updatedExisting = true; } }
				});
				if (addedNew || updatedExisting) { appState.messages.set(conversationId, [...existingMessages]); }
				if (addedNew && isNearBottom) { scrollToBottom(dom.messageArea); }
				if (addedNew) { const latestMsg = existingMessages[existingMessages.length - 1]; updateConversationListSnippet(conversationId, latestMsg); if (partnerSentNew) { const currentConvoData = appState.conversations.find(c => c.id === conversationId); if (currentConvoData) { currentConvoData.last_activity_ts = latestMsg.timestamp; currentConvoData.partner_last_active_ts = latestMsg.timestamp; updateChatHeader(currentConvoData); } } }
				if (newMsgIdsForRead.length > 0) markConversationAsRead(conversationId, newMsgIdsForRead);
			}
		} catch (error) { console.error(`Message polling failed for ${conversationId}:`, error.message); }
	}
	async function markConversationAsRead(conversationId, messageIds = []) {
		if (!conversationId || !appState.currentUser || messageIds.length === 0) return;
		try {
			if (appState.ws && appState.ws.readyState === WebSocket.OPEN) { appState.ws.send(JSON.stringify({ type: 'mark_read', conversationId: conversationId, messageIds: messageIds, readerId: appState.currentUser.id })); } else { await apiCall(`/conversations/${conversationId}/read`, 'POST', { message_ids: messageIds }); }
			const convoIndex = appState.conversations.findIndex(c => c.id === conversationId);
			if (convoIndex > -1 && appState.conversations[convoIndex].unread_count > 0) { appState.conversations[convoIndex].unread_count = Math.max(0, appState.conversations[convoIndex].unread_count - messageIds.length); renderConversationList(); }
		} catch (error) { console.error(`Background mark-as-read failed for ${conversationId}:`, error.message); }
	}

	async function handleOnboardingSubmit(event) {
		event.preventDefault();
		setFormError('onboarding', null);
		const username = dom.onboardingUsername?.value.trim();
		const password = dom.onboardingPassword?.value;
		const masterPassword = dom.onboardingMasterPassword?.value;
		if (!username || username.length < 3) { setFormError('onboarding', 'Username min 3 chars.'); dom.onboardingUsernameProxy?.focus(); return; }
		if (!password || password.length < 8) { setFormError('onboarding', 'Password min 8 chars.'); dom.onboardingPasswordProxy?.focus(); return; }
		if (!masterPassword || masterPassword.length < 10) { setFormError('onboarding', 'Master Password min 10 chars.'); dom.onboardingMasterPasswordProxy?.focus(); return; }
		setState({ isLoading: { ...appState.isLoading, auth: true } });
		setButtonLoading(dom.onboardingSubmit, true);
		try { await apiCall('/setup/admin', 'POST', { username, password, masterPassword }); switchView('login'); dom.onboardingForm?.reset(); } catch (error) { setFormError('onboarding', error.message || 'Setup failed.'); }
		finally { setState({ isLoading: { ...appState.isLoading, auth: false } }); setButtonLoading(dom.onboardingSubmit, false); }
	}
	async function handleUserLoginSubmit(event) {
		event.preventDefault();
		setFormError('login', null);
		const username = dom.loginUsername?.value.trim();
		const password = dom.loginPassword?.value;
		if (!username || !password) { setFormError('login', 'Username and password required.'); dom.loginUsernameProxy?.focus(); return; }
		setState({ isLoading: { ...appState.isLoading, auth: true } });
		setButtonLoading(dom.loginSubmit, true);
		try {
			const response = await apiCall('/auth/login', 'POST', { username, password });
			if (response.success && response.token && response.user) { setState({ currentUser: { ...response.user, token: response.token } }); sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(appState.currentUser)); connectWebSocket(); await initializeChatView(); } else { throw new Error(response.error || 'Login failed.'); }
		} catch (error) { setFormError('login', error.message || 'Login failed.'); setState({ currentUser: null }); sessionStorage.removeItem(SESSION_STORAGE_KEY); }
		finally { setState({ isLoading: { ...appState.isLoading, auth: false } }); setButtonLoading(dom.loginSubmit, false); }
	}
	async function handleAdminLoginSubmit(event) {
		event.preventDefault();
		setFormError('login', null);
		const masterPassword = dom.adminMasterPassword?.value;
		if (!masterPassword) { setFormError('login', 'Master password required.'); dom.adminMasterPasswordProxy?.focus(); return; }
		setState({ isLoading: { ...appState.isLoading, auth: true } });
		setButtonLoading(dom.adminLoginSubmit, true);
		try {
			const response = await apiCall('/auth/admin/login', 'POST', { masterPassword });
			if (response.success && response.token && response.user) { setState({ currentUser: { ...response.user, token: response.token } }); sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(appState.currentUser)); connectWebSocket(); await initializeAdminDashboard(); } else { throw new Error(response.error || 'Admin login failed.'); }
		} catch (error) { setFormError('login', error.message || 'Admin login failed.'); setState({ currentUser: null }); sessionStorage.removeItem(SESSION_STORAGE_KEY); }
		finally { setState({ isLoading: { ...appState.isLoading, auth: false } }); setButtonLoading(dom.adminLoginSubmit, false); }
	}
	async function selectConversation(conversationId) {
		const id = parseInt(String(conversationId), 10);
		if (isNaN(id) || appState.isLoading.messages || id === appState.currentConversationId) return;
		if (messagePollingInterval) clearInterval(messagePollingInterval); messagePollingInterval = null;
		if (dom.messageArea) { dom.messageArea.removeEventListener('scroll', debouncedHandleScroll); dom.messageArea.removeEventListener('touchstart', handleTouchStart); dom.messageArea.removeEventListener('touchmove', handleTouchMove); dom.messageArea.removeEventListener('touchend', handleTouchEnd); }
		cancelEdit(); cancelReply();
		document.querySelectorAll('.conversation-item.active').forEach((item) => item.classList.remove('active'));
		if (dom.messageArea) dom.messageArea.innerHTML = '';
		if (dom.manualLoadOlderButton && !dom.messageArea.contains(dom.manualLoadOlderButton)) dom.messageArea.prepend(dom.manualLoadOlderButton);
		if (dom.olderMessagesLoader && !dom.messageArea.contains(dom.olderMessagesLoader)) {
			if (dom.manualLoadOlderButton) dom.manualLoadOlderButton.insertAdjacentElement('afterend', dom.olderMessagesLoader);
			else dom.messageArea.prepend(dom.olderMessagesLoader);
		}
		hideElement(dom.olderMessagesLoader); hideElement(dom.manualLoadOlderButton);


		setState({ currentConversationId: id, isLoading: { ...appState.isLoading, olderMessages: false } });
		const selectedItem = document.querySelector(`.conversation-item[data-conversation-id="${id}"]`);
		if (selectedItem) selectedItem.classList.add('active');
		const conversation = appState.conversations.find((c) => c.id === id);
		if (conversation) {
			updateChatHeader(conversation);
			showElement(dom.chatViewContent); hideElement(dom.chatViewPlaceholder);
			if (dom.messageArea && isTouchDevice()) { dom.messageArea.addEventListener('touchstart', handleTouchStart, { passive: true }); dom.messageArea.addEventListener('touchmove', handleTouchMove, { passive: false }); dom.messageArea.addEventListener('touchend', handleTouchEnd, { passive: true }); }
			await fetchMessagesForConversation(id);
			startMessagePolling(id);
			if (dom.messageInputProxy) dom.messageInputProxy.focus();
			if (isMobileView()) dom.body.classList.remove('left-panel-active');
		} else { console.error(`Convo data for ID ${id} not found locally.`); showError("Could not load conversation data."); clearChatView(); }
	}
	async function handleSendMessage() {
		if (!dom.messageInput || !dom.sendButton || !appState.currentUser || !appState.currentConversationId || !dom.messageInputProxy || appState.isLoading.sendingMessage) return;
		const content = dom.messageInput.value.trim();
		if (!content && !appState.editingMessageId) return;
		if (!content && appState.editingMessageId) { await handleSaveEdit(); return; }
		dom.messageInputProxy.setAttribute('readonly', 'true');
		appState.lastFocusedElement = document.activeElement;
		setState({ isLoading: { ...appState.isLoading, sendingMessage: true } });
		setButtonLoading(dom.sendButton, true);
		dom.messageInputProxy.contentEditable = 'false';
		const tempId = `temp_${Date.now()}`;
		const wasReplyingTo = appState.replyingToMessageId;
		const replyInfo = getReplyInfoForOptimistic(wasReplyingTo);
		const optimisticMessage = { id: tempId, conversation_id: appState.currentConversationId, sender_id: appState.currentUser.id, sender_username: appState.currentUser.username, content: content, timestamp: new Date().toISOString(), isOptimistic: true, is_edited: false, edited_at: null, reply_to_message_id: wasReplyingTo, reply_snippet: replyInfo?.snippet, reply_sender_username: replyInfo?.sender, isReadByPartner: false, };
		addMessageToUI(optimisticMessage, false);
		scrollToBottom(dom.messageArea, true);
		const originalInputText = dom.messageInputProxy.textContent;
		dom.messageInputProxy.textContent = ''; dom.messageInput.value = ''; dom.messageInputProxy.classList.remove('has-content');
		adjustTextareaHeight();
		cancelReply();
		try {
			const result = await apiCall(`/conversations/${appState.currentConversationId}/messages`, 'POST', { content: content, reply_to_message_id: wasReplyingTo, });
			if (result?.success && result.message) {
				const confirmedMessage = result.message;
				let existingMessages = appState.messages.get(appState.currentConversationId) || [];
				existingMessages = existingMessages.filter(m => m.id !== tempId && m.id !== confirmedMessage.id);
				existingMessages.push(confirmedMessage);
				appState.messages.set(appState.currentConversationId, [...existingMessages]);
				updateOptimisticMessage(tempId, confirmedMessage);
				updateConversationListSnippet(appState.currentConversationId, confirmedMessage);
				const currentConvoData = appState.conversations.find(c => c.id === appState.currentConversationId);
				if (currentConvoData) updateChatHeader(currentConvoData);
			} else { throw new Error(result?.error || 'Send failed.'); }
		} catch (error) {
			showError(`Send failed: ${error.message}`);
			removeOptimisticMessage(tempId);
			dom.messageInputProxy.textContent = originalInputText;
			dom.messageInput.value = originalInputText;
			if (originalInputText) dom.messageInputProxy.classList.add('has-content');
			adjustTextareaHeight();
			if (wasReplyingTo) { const originalMsg = appState.messages.get(appState.currentConversationId)?.find(m => m.id === wasReplyingTo); if (originalMsg) { handleReplyClick(wasReplyingTo, originalMsg.sender_username, originalMsg.content); } }
		} finally {
			dom.messageInputProxy.removeAttribute('readonly');
			setState({ isLoading: { ...appState.isLoading, sendingMessage: false } });
			const currentConvo = appState.conversations.find((c) => c.id === appState.currentConversationId);
			enableChatInput(currentConvo);
			setButtonLoading(dom.sendButton, false);
			requestAnimationFrame(() => { if (dom.messageInputProxy && (dom.messageInputProxy.contentEditable === "true" || dom.messageInputProxy.contentEditable === true)) { if (appState.lastFocusedElement === dom.messageInputProxy || isTouchDevice()) { dom.messageInputProxy.focus(); const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(dom.messageInputProxy); range.collapse(false); sel?.removeAllRanges(); sel?.addRange(range); } } appState.lastFocusedElement = null; });
		}
	}
	async function handleDeleteMessage(conversationId, messageId, messageElement) {
		if (appState.isLoading.deletingMessage || !messageElement) return;
		const confirmed = await showConfirmation('Delete this message? This cannot be undone.');
		if (!confirmed) return;
		setState({ isLoading: { ...appState.isLoading, deletingMessage: true } });
		messageElement.style.opacity = '0.5';
		messageElement.style.pointerEvents = 'none';
		const deleteButtonEl = messageElement.querySelector('.delete-button');
		if (deleteButtonEl) { deleteButtonEl.classList.add('disabled'); deleteButtonEl.setAttribute('aria-disabled', 'true'); }
		try {
			await apiCall(`/messages/${messageId}`, 'DELETE');
			removeMessageUI(conversationId, messageId);
			let convoMessages = appState.messages.get(conversationId) || [];
			appState.messages.set(conversationId, convoMessages.filter((m) => m.id !== messageId));
			const convoIndex = appState.conversations.findIndex(c => c.id === conversationId);
			if (convoIndex > -1) { const remainingMessages = appState.messages.get(conversationId) || []; const newLastMessage = remainingMessages.length > 0 ? remainingMessages[remainingMessages.length - 1] : null; updateConversationListSnippet(conversationId, newLastMessage); }
		} catch (error) {
			showError(`Delete failed: ${error.message}`);
			messageElement.style.opacity = '1';
			messageElement.style.pointerEvents = 'auto';
			if (deleteButtonEl) { deleteButtonEl.classList.remove('disabled'); deleteButtonEl.removeAttribute('aria-disabled'); }
		} finally { setState({ isLoading: { ...appState.isLoading, deletingMessage: false } }); }
	}
	function logout() {
		if (messagePollingInterval) clearInterval(messagePollingInterval); messagePollingInterval = null;
		if (statusUpdateInterval) clearInterval(statusUpdateInterval); statusUpdateInterval = null;
		if (dom.messageArea) { dom.messageArea.removeEventListener('scroll', debouncedHandleScroll); dom.messageArea.removeEventListener('touchstart', handleTouchStart); dom.messageArea.removeEventListener('touchmove', handleTouchMove); dom.messageArea.removeEventListener('touchend', handleTouchEnd); }
		disconnectWebSocket();
		setState({ currentUser: null, currentConversationId: null, conversations: [], users: [], blockedUsers: [], adminUserList: [], adminStats: {}, messages: new Map(), oldestMessageTimestamp: new Map(), hasReachedOldestMessage: new Map(), lastMessageSenderIdMap: new Map(), lastMessageTimestampMap: new Map(), editingMessageId: null, replyingToMessageId: null });
		sessionStorage.removeItem(SESSION_STORAGE_KEY);
		switchView('login');
		if (dom.conversationListArea) dom.conversationListArea.innerHTML = '';
		clearChatView();
		if (dom.adminUserListBody) dom.adminUserListBody.innerHTML = '';
		renderAdminStats({});
		dom.onboardingForm?.reset(); dom.userLoginForm?.reset(); dom.adminLoginForm?.reset(); dom.adminAddUserForm?.reset();
		setFormError('login', null); setFormError('onboarding', null); setFormError('adminUser', null); setFormError('manageBlocks', null);
		hideError();
	}
	function openManageBlocksModal() { setFormError('manageBlocks', null); fetchBlockedUsers(); showElement(dom.manageBlocksModal); }
	function closeManageBlocksModal(event) { if (!event) { hideElement(dom.manageBlocksModal); return; } if (event.target !== dom.manageBlocksModal && !event.target.closest('.modal-close-button') && !(event.currentTarget === dom.manageBlocksModal && !event.target.closest('.glass-panel'))) { return; } hideElement(dom.manageBlocksModal); }
	async function handleUnblockUser(event) {
		const button = event.currentTarget;
		const userIdToUnblock = parseInt(button.dataset.userId, 10);
		const username = button.dataset.username || 'this user';
		if (isNaN(userIdToUnblock)) return;
		setButtonLoading(button, true);
		setFormError('manageBlocks', null);
		try {
			await apiCall(`/blocks/${userIdToUnblock}`, 'DELETE');
			setState({ blockedUsers: appState.blockedUsers.filter(u => u.id !== userIdToUnblock) });
			renderBlockedUsersList();
			fetchChatData();
			if (appState.currentConversationId) { const currentConvo = appState.conversations.find(c => c.id === appState.currentConversationId); if (currentConvo?.partner_id === userIdToUnblock) { updateChatHeader(currentConvo); enableChatInput(currentConvo); } }
		} catch (error) { setFormError('manageBlocks', `Failed to unblock ${username}: ${error.message}`); }
		finally { const stillExistingButton = dom.manageBlocksModal?.querySelector(`.unblock-button[data-user-id="${userIdToUnblock}"]`); if (stillExistingButton) setButtonLoading(stillExistingButton, false); }
	}
	async function handleBlockUser(userIdToBlock, usernameToBlock = 'this user') {
		if (!appState.currentUser || isNaN(userIdToBlock) || userIdToBlock === appState.currentUser.id) return;
		if (appState.blockedUsers.some(u => u.id === userIdToBlock)) { showError(`${usernameToBlock} is already blocked.`); return; }
		const confirmation = await showConfirmation(`Block ${usernameToBlock}?`);
		if (!confirmation) return;
		const headerBlockButton = dom.chatViewHeader?.querySelector('#block-user-button');
		const isBlockingFromHeader = headerBlockButton && parseInt(headerBlockButton.dataset.userId, 10) === userIdToBlock;
		setState({ isLoading: { ...appState.isLoading, blockingUser: true } });
		if (isBlockingFromHeader) setButtonLoading(headerBlockButton, true);
		try {
			await apiCall('/blocks', 'POST', { userId: userIdToBlock });
			setState({ blockedUsers: [...appState.blockedUsers, { id: userIdToBlock, username: usernameToBlock }] });
			renderBlockedUsersList();
			if (appState.currentConversationId) { const currentConvo = appState.conversations.find(c => c.id === appState.currentConversationId); if (currentConvo?.partner_id === userIdToBlock) { updateChatHeader(currentConvo); enableChatInput(currentConvo); } }
			fetchChatData();
		} catch (error) { showError(`Failed to block ${usernameToBlock}: ${error.message}`); }
		finally { setState({ isLoading: { ...appState.isLoading, blockingUser: false } }); if (isBlockingFromHeader && headerBlockButton) setButtonLoading(headerBlockButton, false); }
	}
	function handleBlockUserFromHeader(event) {
		const button = event.currentTarget;
		const id = parseInt(button.dataset.userId, 10);
		const name = dom.chatPartnerName?.textContent || 'this user';
		if (!isNaN(id)) { handleBlockUser(id, name); }
	}
	async function handleStartNewConversation(partnerId) {
		if (!partnerId || !appState.currentUser || partnerId === appState.currentUser.id || appState.isLoading.conversations) return;
		const existingItem = dom.conversationListArea?.querySelector(`.conversation-item[data-partner-id="${partnerId}"]`);
		if (existingItem && existingItem.dataset.conversationId) { selectConversation(existingItem.dataset.conversationId); return; }
		const userItem = dom.conversationListArea?.querySelector(`.user-list-item[data-user-id="${partnerId}"]`);
		if (userItem) userItem.style.opacity = '0.5';
		try {
			const response = await apiCall('/conversations', 'POST', { partnerId });
			if (response.success && response.conversationId) { await fetchChatData(); selectConversation(response.conversationId); } else { throw new Error(response.error || 'Failed.'); }
		} catch (error) { showError(`Could not start chat: ${error.message}`); if (userItem) userItem.style.opacity = '1'; }
	}
	async function handleAdminAddUserSubmit(event) {
		event.preventDefault();
		setFormError('adminUser', null);
		const username = dom.adminAddUsername?.value.trim();
		const password = dom.adminAddPassword?.value;
		if (!username || username.length < 3) { setFormError('adminUser', 'Username min 3 chars.'); dom.adminAddUsernameProxy?.focus(); return; }
		if (!password || password.length < 8) { setFormError('adminUser', 'Password min 8 chars.'); dom.adminAddPasswordProxy?.focus(); return; }
		setState({ isLoading: { ...appState.isLoading, adminAction: true } });
		setButtonLoading(dom.adminAddUserButton, true);
		try {
			await apiCall('/admin/users', 'POST', { username, password });
			dom.adminAddUserForm?.reset();
			fetchAdminUsers();
			setFormError('adminUser', `User '${username}' created successfully.`);
			setTimeout(() => { setFormError('adminUser', null); }, 4000);
		} catch (error) { setFormError('adminUser', error.message || 'Failed.'); }
		finally { setState({ isLoading: { ...appState.isLoading, adminAction: false } }); setButtonLoading(dom.adminAddUserButton, false); }
	}
	async function handleDeleteUserByAdmin(event) {
		const button = event.currentTarget;
		const userIdToDelete = parseInt(button.dataset.userId, 10);
		const username = button.dataset.username || 'this user';
		if (isNaN(userIdToDelete)) return;
		const confirmed = await showConfirmation(`DELETE USER: ${username}? This is permanent.`);
		if (!confirmed) return;
		setState({ isLoading: { ...appState.isLoading, adminAction: true } });
		setButtonLoading(button, true);
		try {
			await apiCall(`/admin/users/${userIdToDelete}`, 'DELETE');
			fetchAdminUsers();
			setFormError('adminUser', `User '${username}' deleted successfully.`);
			setTimeout(() => { setFormError('adminUser', null); }, 4000);
		} catch (error) { setFormError('adminUser', `Failed to delete ${username}: ${error.message}`); setButtonLoading(button, false); }
		finally { setState({ isLoading: { ...appState.isLoading, adminAction: false } }); }
	}
	function handleMobileMenuToggle() { dom.body.classList.toggle('left-panel-active'); if (dom.panelOverlay) { dom.panelOverlay.style.display = dom.body.classList.contains('left-panel-active') ? 'block' : 'none'; } }
	function closeMobilePanel() { dom.body.classList.remove('left-panel-active'); if (dom.panelOverlay) dom.panelOverlay.style.display = 'none'; }
	function getReplyInfoForOptimistic(replyToId) { if (!replyToId || !appState.currentConversationId) return null; const messagesInConv = appState.messages.get(appState.currentConversationId) || []; const originalMsg = messagesInConv.find(m => m.id === replyToId); if (!originalMsg) return null; return { snippet: originalMsg.content.substring(0, 100), sender: originalMsg.sender_username || 'User', }; }
	function handleReplyClick(messageId, senderUsername, messageContent) {
		if (!dom.messageInputProxy || !dom.replyContextArea) return;
		cancelEdit();
		setState({ replyingToMessageId: messageId });
		dom.replyContextUser.textContent = escapeHtml(senderUsername);
		dom.replyContextText.textContent = escapeHtml(messageContent.substring(0, 100));
		dom.replyContextArea.dataset.replyToId = String(messageId);
		showElement(dom.replyContextArea);
		dom.messageInputProxy?.focus();
		adjustTextareaHeight();
		hideEmojiPanel();
	}
	function cancelReply() { setState({ replyingToMessageId: null }); if (dom.replyContextArea) hideElement(dom.replyContextArea); if (dom.messageInputProxy && !appState.editingMessageId && (dom.messageInputProxy.contentEditable === 'true' || dom.messageInputProxy.contentEditable === true)) dom.messageInputProxy.focus(); adjustTextareaHeight(); }
	function handleShowEditInput(messageElement, messageId, currentContent) {
		if (!messageElement || !appState.currentUser || parseInt(messageElement.dataset.senderId, 10) !== appState.currentUser.id) return;
		if (appState.editingMessageId === messageId) return;
		cancelEdit(); cancelReply();
		setState({ editingMessageId: messageId });
		messageElement.classList.add('editing');
		const contentSpan = messageElement.querySelector('.message-content');
		const metaDiv = messageElement.querySelector('.message-meta');
		const actionsDiv = messageElement.querySelector('.message-actions');
		if (contentSpan) contentSpan.style.display = 'none';
		if (metaDiv) metaDiv.style.display = 'none';
		if (actionsDiv) actionsDiv.style.display = 'none';
		const editContainer = document.createElement('div');
		editContainer.className = 'edit-input-container';
		const editInput = document.createElement('div');
		editInput.className = 'edit-input-contenteditable';
		editInput.contentEditable = "true";
		editInput.textContent = currentContent;
		editInput.dataset.placeholder = "Edit message...";
		adjustTextareaHeight(editInput);
		if (!currentContent.trim()) editInput.classList.remove('has-content'); else editInput.classList.add('has-content');
		const buttonGroup = document.createElement('div');
		buttonGroup.className = 'edit-button-group';
		const saveButton = document.createElement('div');
		saveButton.className = 'custom-button button-confirm';
		saveButton.role = "button"; saveButton.tabIndex = 0;
		saveButton.innerHTML = '<i class="fa-solid fa-check button-icon"></i><span class="button-text"> Save</span>';
		const cancelButton = document.createElement('div');
		cancelButton.className = 'custom-button button-cancel';
		cancelButton.role = "button"; cancelButton.tabIndex = 0;
		cancelButton.innerHTML = '<i class="fa-solid fa-xmark button-icon"></i><span class="button-text"> Cancel</span>';
		buttonGroup.appendChild(cancelButton);
		buttonGroup.appendChild(saveButton);
		editContainer.appendChild(editInput);
		editContainer.appendChild(buttonGroup);
		messageElement.appendChild(editContainer);
		saveButton.addEventListener('click', (e) => handleSaveEdit(e, editInput, saveButton));
		cancelButton.addEventListener('click', cancelEdit);
		editInput.addEventListener('input', () => { adjustTextareaHeight(editInput); editInput.classList.toggle('has-content', !!editInput.textContent.trim()); });
		editInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(e, editInput, saveButton); } else if (e.key === 'Escape') { cancelEdit(); } });
		adjustTextareaHeight(editInput);
		editInput.focus();
		const range = document.createRange();
		const sel = window.getSelection();
		range.selectNodeContents(editInput);
		range.collapse(false);
		sel?.removeAllRanges();
		sel?.addRange(range);
		hideEmojiPanel();
	}
	function cancelEdit() {
		if (!appState.editingMessageId || !dom.messageArea) return;
		const messageElement = dom.messageArea.querySelector(`.message.editing[data-message-id="${appState.editingMessageId}"]`);
		if (messageElement) {
			messageElement.classList.remove('editing');
			messageElement.querySelector('.edit-input-container')?.remove();
			const contentSpan = messageElement.querySelector('.message-content');
			const metaDiv = messageElement.querySelector('.message-meta');
			const actionsDiv = messageElement.querySelector('.message-actions');
			if (contentSpan) contentSpan.style.display = '';
			if (metaDiv) metaDiv.style.display = '';
			if (actionsDiv) actionsDiv.style.display = '';
		}
		setState({ editingMessageId: null });
		if (dom.messageInputProxy && (dom.messageInputProxy.contentEditable === 'true' || dom.messageInputProxy.contentEditable === true)) dom.messageInputProxy.focus();
	}
	async function handleSaveEdit(event, editInput, saveButton) {
		if (!appState.editingMessageId || !dom.messageArea) return;
		const messageElement = dom.messageArea.querySelector(`.message.editing[data-message-id="${appState.editingMessageId}"]`);
		if (!messageElement) return;
		if (!editInput || !saveButton) { const container = messageElement.querySelector('.edit-input-container'); if (!container) { cancelEdit(); return; } editInput = container.querySelector('.edit-input-contenteditable'); saveButton = container.querySelector('.custom-button.button-confirm'); if (!editInput || !saveButton) { cancelEdit(); return; } }
		const newContent = editInput.textContent.trim();
		const originalContent = appState.messages.get(appState.currentConversationId)?.find(m => m.id === appState.editingMessageId)?.content;
		if (!newContent) { showError("Message content cannot be empty."); editInput.focus(); return; }
		if (newContent === originalContent) { cancelEdit(); return; }
		setButtonLoading(saveButton, true);
		editInput.contentEditable = 'false';
		try {
			const response = await apiCall(`/messages/${appState.editingMessageId}`, 'PATCH', { content: newContent });
			if (response.success) {
				const convoMessages = appState.messages.get(appState.currentConversationId) || [];
				const msgIndex = convoMessages.findIndex(m => m.id === appState.editingMessageId);
				let editedMessage = null;
				if (msgIndex > -1) { convoMessages[msgIndex].content = newContent; convoMessages[msgIndex].is_edited = true; convoMessages[msgIndex].edited_at = response.edited_at || new Date().toISOString(); editedMessage = convoMessages[msgIndex]; }
				cancelEdit();
				const contentSpan = messageElement.querySelector('.message-content');
				if (contentSpan) contentSpan.innerHTML = `${escapeHtml(newContent)} <span class="edited-indicator">(edited)</span>`;
				messageElement.dataset.timestamp = response.edited_at || new Date().toISOString();
				if (editedMessage) { const latestMessageInCache = convoMessages.length > 0 ? convoMessages[convoMessages.length - 1] : null; if (latestMessageInCache && latestMessageInCache.id === appState.editingMessageId) { updateConversationListSnippet(appState.currentConversationId, editedMessage); } }
			} else { throw new Error(response.error || "Failed."); }
		} catch (error) {
			showError(`Edit failed: ${error.message}`);
			setButtonLoading(saveButton, false);
			editInput.contentEditable = 'true';
			editInput.focus();
		} finally {
			const stillEditing = dom.messageArea.querySelector(`.message.editing[data-message-id="${appState.editingMessageId}"]`);
			if (stillEditing) { const stillSaveButton = stillEditing.querySelector('.custom-button.button-confirm'); const stillEditInput = stillEditing.querySelector('.edit-input-contenteditable'); if (stillSaveButton) setButtonLoading(stillSaveButton, false); if (stillEditInput) stillEditInput.contentEditable = 'true'; }
		}
	}
	function updateConversationListSnippet(conversationId, latestMessageOrNull) {
		if (!conversationId || !appState.currentUser) return;
		const convoIndex = appState.conversations.findIndex(c => c.id === conversationId);
		if (convoIndex > -1) {
			const convo = appState.conversations[convoIndex];
			if (latestMessageOrNull) { let snippetPrefix = latestMessageOrNull.sender_id === appState.currentUser.id ? 'You: ' : ''; convo.last_message_content = latestMessageOrNull.content; convo.last_message_sender = latestMessageOrNull.sender_username || (latestMessageOrNull.sender_id === appState.currentUser.id ? appState.currentUser.username : 'User'); convo.last_message_ts = latestMessageOrNull.timestamp; convo.last_activity_ts = latestMessageOrNull.timestamp; } else { convo.last_message_content = 'No messages yet'; convo.last_message_sender = null; convo.last_message_ts = null; }
			renderConversationList();
		}
	}
	function scrollToMessage(messageId) {
		if (!dom.messageArea || !messageId) return;
		const messageElement = dom.messageArea.querySelector(`.message[data-message-id="${messageId}"]`);
		if (messageElement) { messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); messageElement.classList.add('highlight'); setTimeout(() => { messageElement.classList.remove('highlight'); }, 1500); } else { console.warn(`Message element ${messageId} not found.`); showError("Original message not currently loaded.", 3000); }
	}
	function handleMessageAreaScroll() {
		if (!dom.messageArea || !appState.currentConversationId) return;
		updateManualLoadButtonVisibility();
		if (dom.messageArea.scrollTop < SCROLL_LOAD_THRESHOLD &&
			!appState.isLoading.olderMessages &&
			!appState.isLoading.messages &&
			!appState.hasReachedOldestMessage.get(appState.currentConversationId) &&
			dom.manualLoadOlderButton && dom.manualLoadOlderButton.style.display === 'none'
		) {
			fetchOlderMessages(appState.currentConversationId, false);
		}
		hideEmojiPanel();
	}

	function toggleEmojiPanel() { if (dom.emojiPanel.style.display === 'none') { populateEmojiPanel(); showElement(dom.emojiPanel); } else { hideElement(dom.emojiPanel); } }
	function hideEmojiPanel() { if (dom.emojiPanel) hideElement(dom.emojiPanel); }
	function populateEmojiPanel() {
		if (!dom.emojiGrid || dom.emojiGrid.childElementCount > 0) return;
		dom.emojiGrid.innerHTML = '';
		COMMON_EMOJIS.forEach(emoji => { const btn = document.createElement('button'); btn.className = 'emoji-item'; btn.textContent = emoji; btn.setAttribute('aria-label', `Insert emoji ${emoji}`); btn.type = 'button'; btn.addEventListener('click', () => handleEmojiClick(emoji)); dom.emojiGrid.appendChild(btn); });
	}
	function handleEmojiClick(emoji) { if (!dom.messageInputProxy) return; insertTextAtCursor(emoji); hideEmojiPanel(); dom.messageInputProxy.focus(); }
	function insertTextAtCursor(text) {
		if (!dom.messageInputProxy || !dom.messageInputProxy.isContentEditable) return;
		dom.messageInputProxy.focus();
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) { dom.messageInputProxy.textContent += text; dom.messageInputProxy.dispatchEvent(new Event('input', { bubbles: true })); return; }
		const range = sel.getRangeAt(0);
		range.deleteContents();
		const textNode = document.createTextNode(text);
		range.insertNode(textNode);
		range.setStartAfter(textNode);
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
		dom.messageInputProxy.dispatchEvent(new Event('input', { bubbles: true }));
	}
	function handleMessageInputKeyDown(e) {
		if (e.key === 'Enter') {
			if (isTouchDevice()) {
				if (e.shiftKey) { e.preventDefault(); handleSendMessage(); }
			} else {
				if (e.shiftKey) { return; }
				e.preventDefault();
				handleSendMessage();
			}
		}
	}

	function handleTouchStart(e) {
		const touch = e.touches[0]; const targetEl = e.target.closest('.message'); if (!targetEl || appState.editingMessageId) { resetSwipeState(); return; }
		appState.swipeState.startX = touch.clientX; appState.swipeState.startY = touch.clientY; appState.swipeState.currentX = touch.clientX; appState.swipeState.currentY = touch.clientY; appState.swipeState.messageEl = targetEl; appState.swipeState.isSwiping = false; appState.swipeState.targetId = targetEl.dataset.messageId; appState.swipeState.confirmedSwipe = false;
	}
	function handleTouchMove(e) {
		if (!appState.swipeState.messageEl || e.touches.length === 0) return;
		const touch = e.touches[0];
		const deltaX = touch.clientX - appState.swipeState.startX;
		const deltaY = touch.clientY - appState.swipeState.startY;
		appState.swipeState.currentX = touch.clientX;
		appState.swipeState.currentY = touch.clientY;
		if (!appState.swipeState.confirmedSwipe) { if (Math.abs(deltaX) > 15 && Math.abs(deltaY) < SWIPE_VERTICAL_MAX_DEVIATION) { appState.swipeState.confirmedSwipe = true; } else if (Math.abs(deltaY) > 10) { resetSwipeState(); return; } }
		if (appState.swipeState.confirmedSwipe) {
			if (e.cancelable) e.preventDefault();
			let translateX = 0;
			const isReceived = appState.swipeState.messageEl.classList.contains('received');
			const isSent = appState.swipeState.messageEl.classList.contains('sent');
			if (isReceived && deltaX > 0) { translateX = Math.min(deltaX, SWIPE_THRESHOLD + 30); } else if (isSent && deltaX < 0) { translateX = Math.max(deltaX, -(SWIPE_THRESHOLD + 30)); } else { return; }
			appState.swipeState.messageEl.style.transform = `translateX(${translateX}px)`;
			appState.swipeState.messageEl.classList.add('swiping');
		}
	}
	function handleTouchEnd(e) {
		if (!appState.swipeState.confirmedSwipe || !appState.swipeState.messageEl) { resetSwipeState(); return; }
		const deltaX = appState.swipeState.currentX - appState.swipeState.startX;
		const targetIsReceived = appState.swipeState.messageEl.classList.contains('received');
		const targetIsSent = appState.swipeState.messageEl.classList.contains('sent');
		if ((targetIsReceived && deltaX > SWIPE_THRESHOLD) || (targetIsSent && deltaX < -SWIPE_THRESHOLD)) { const msgId = parseInt(appState.swipeState.targetId, 10); const msgData = appState.messages.get(appState.currentConversationId)?.find(m => m.id === msgId); if (msgData) { handleReplyClick(msgId, msgData.sender_username || 'User', msgData.content); } }
		resetSwipeState();
	}
	function resetSwipeState() { if (appState.swipeState.messageEl) { appState.swipeState.messageEl.style.transform = ''; appState.swipeState.messageEl.classList.remove('swiping'); } appState.swipeState = { startX: 0, startY: 0, currentX: 0, currentY: 0, messageEl: null, isSwiping: false, targetId: null, confirmedSwipe: false }; }

	async function initializeApp() {
		switchView('loading');
		applyTheme(getInitialTheme());
		let adminExists = null;
		try { adminExists = await checkSetupStatus(); } catch (e) { console.error("Setup check failed", e); hideElement(dom.loadingScreen); return; }
		if (typeof adminExists !== 'boolean') { showError('Could not determine application status.', 10000); hideElement(dom.loadingScreen); return; }
		const savedSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
		if (!adminExists) { sessionStorage.removeItem(SESSION_STORAGE_KEY); setState({ currentUser: null }); switchView('onboarding'); return; }
		if (savedSession) {
			try {
				const parsedUser = JSON.parse(savedSession);
				if (!parsedUser || !parsedUser.token || !parsedUser.id || typeof parsedUser.isAdmin !== 'boolean' || !parsedUser.username) { throw new Error("Invalid session data."); }
				setState({ currentUser: parsedUser });
				connectWebSocket();
				if (appState.currentUser.isAdmin) { await initializeAdminDashboard(); } else { await initializeChatView(); } return;
			} catch (e) { sessionStorage.removeItem(SESSION_STORAGE_KEY); setState({ currentUser: null }); disconnectWebSocket(); if (e.status !== 401) switchView('login'); else if (appState.currentView !== 'login') switchView('login'); return; }
		}
		switchView('login');
	}
	async function initializeChatView() {
		if (!appState.currentUser || appState.currentUser.isAdmin) { logout(); return; }
		switchView('chat');
		if (dom.myUsernameSummary) dom.myUsernameSummary.textContent = escapeHtml(appState.currentUser.username);
		if (dom.myAvatarSummary) { dom.myAvatarSummary.classList.remove('offline'); dom.myAvatarSummary.classList.add('online'); }
		clearChatView();
		if (statusUpdateInterval) clearInterval(statusUpdateInterval);
		statusUpdateInterval = setInterval(updateActiveStatusUI, STATUS_UPDATE_INTERVAL_MS);
		updateActiveStatusUI();
		setState({ isLoading: { ...appState.isLoading, blockedUsers: true, conversations: true, users: true } });
		renderConversationList(); renderBlockedUsersList();
		await fetchBlockedUsers();
		await fetchChatData();
	}
	async function initializeAdminDashboard() {
		if (!appState.currentUser || !appState.currentUser.isAdmin) { logout(); return; }
		switchView('admin');
		if (dom.adminUsernameDisplay) dom.adminUsernameDisplay.textContent = escapeHtml(appState.currentUser.username);
		if (dom.adminUserListBody) dom.adminUserListBody.innerHTML = '';
		renderAdminStats({});
		if (statusUpdateInterval) clearInterval(statusUpdateInterval);
		statusUpdateInterval = setInterval(updateActiveStatusUI, STATUS_UPDATE_INTERVAL_MS);
		setState({ isLoading: { ...appState.isLoading, adminStats: true, allUsersAdmin: true } });
		renderAdminUserList();
		await fetchAdminStats();
		await fetchAdminUsers();
	}

	function initializeCustomInputs() {
		document.querySelectorAll('.custom-input[contenteditable="true"], .custom-textarea[contenteditable="true"], .edit-input-contenteditable[contenteditable="true"]').forEach(customEl => {
			const targetInputId = customEl.dataset.targetInput;
			const actualInput = targetInputId ? document.getElementById(targetInputId) : null;
			const wrapper = customEl.closest('.custom-input-wrapper');
			const form = actualInput ? actualInput.form : customEl.closest('form');

			if (actualInput) {
				customEl.addEventListener('input', () => {
					actualInput.value = customEl.textContent;
					customEl.classList.toggle('has-content', !!customEl.textContent.trim());
					actualInput.dispatchEvent(new Event('input', { bubbles: true }));
					if (customEl.classList.contains('custom-textarea') || customEl.classList.contains('edit-input-contenteditable')) {
						adjustTextareaHeight(customEl);
					}
				});
				if (form) {
					form.addEventListener('reset', () => {
						setTimeout(() => {
							customEl.textContent = actualInput.value;
							customEl.classList.toggle('has-content', !!actualInput.value);
							if (customEl.classList.contains('custom-textarea') || customEl.classList.contains('edit-input-contenteditable')) { adjustTextareaHeight(customEl); }
						}, 0);
					});
				}
				if (actualInput.value) {
					customEl.textContent = actualInput.value;
					customEl.classList.add('has-content');
					if (customEl.classList.contains('custom-textarea') || customEl.classList.contains('edit-input-contenteditable')) { adjustTextareaHeight(customEl); }
				} else {
					customEl.classList.remove('has-content');
				}
			} else if (customEl.classList.contains('edit-input-contenteditable')) {
				customEl.addEventListener('input', () => {
					customEl.classList.toggle('has-content', !!customEl.textContent.trim());
					adjustTextareaHeight(customEl);
				});
				if (customEl.textContent) customEl.classList.add('has-content'); else customEl.classList.remove('has-content');
			}

			if (form && (form.id === 'onboarding-form' || form.id === 'user-login-form' || form.id === 'admin-login-form' || form.id === 'admin-add-user-form')) {
				customEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						const submitButton = form.querySelector('.custom-button.button-primary') || form.querySelector('[id$="-submit"]');
						if (submitButton && !submitButton.classList.contains('disabled')) {
							submitButton.click();
						}
					}
				});
			}

			if (wrapper && wrapper.classList.contains('custom-input-wrapper')) {
				customEl.addEventListener('focus', () => { wrapper.classList.add('focused'); hideEmojiPanel(); });
				customEl.addEventListener('blur', () => wrapper.classList.remove('focused'));
			}
			if (customEl.dataset.isPassword !== undefined) { customEl.style.webkitTextSecurity = 'disc'; }
		});
	}

	function connectWebSocket() {
		if (appState.ws && appState.ws.readyState === WebSocket.OPEN) return;
		if (!appState.currentUser || !appState.currentUser.token) { return; }
		console.log("Attempting to connect WebSocket to:", WEBSOCKET_URL); // Use the constant
		appState.ws = new WebSocket(WEBSOCKET_URL); // Use the constant
		appState.ws.onopen = () => {
			console.log("WebSocket connected.");
			appState.ws.send(JSON.stringify({ type: 'authenticate', token: appState.currentUser.token }));
			startWebSocketTimers();
			if (appState.ws && appState.ws.readyState === WebSocket.OPEN && appState.currentUser) appState.ws.send(JSON.stringify({ type: 'status_update', userId: appState.currentUser.id, status: 'online', timestamp: new Date().toISOString() }));
		};
		appState.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				switch (data.type) {
					case 'user_online': handleUserOnlineStatusUpdate(data.userId, true, data.timestamp); break;
					case 'user_offline': handleUserOnlineStatusUpdate(data.userId, false, data.timestamp); break;
					case 'message_read': handleMessageReadStatusUpdate(data.conversationId, data.messageIds || [data.messageId], data.readerId); break;
					case 'pong': console.log("WebSocket: Received pong"); break;
				}
			} catch (e) { console.error("Error processing WebSocket message:", e, event.data); }
		};
		appState.ws.onerror = (error) => console.error("WebSocket error:", error);
		appState.ws.onclose = (event) => { console.log("WebSocket disconnected:", event.code, event.reason); stopWebSocketTimers(); appState.ws = null; };
	}
	function disconnectWebSocket() {
		stopWebSocketTimers();
		if (appState.ws) {
			if (appState.ws.readyState === WebSocket.OPEN && appState.currentUser) {
				try { appState.ws.send(JSON.stringify({ type: 'status_update', userId: appState.currentUser.id, status: 'offline', timestamp: new Date().toISOString() })); } catch (e) { console.warn("Error sending offline status on disconnect:", e); }
			}
			appState.ws.close();
			appState.ws = null;
		}
	}
	function startWebSocketTimers() {
		if (wsHeartbeatInterval) clearInterval(wsHeartbeatInterval);
		wsHeartbeatInterval = setInterval(() => {
			if (appState.ws && appState.ws.readyState === WebSocket.OPEN && appState.currentUser) {
				appState.ws.send(JSON.stringify({ type: 'ping', userId: appState.currentUser.id }));
				appState.ws.send(JSON.stringify({ type: 'status_update', userId: appState.currentUser.id, status: 'online', timestamp: new Date().toISOString() }));
			}
		}, WS_HEARTBEAT_INTERVAL_MS);
	}
	function stopWebSocketTimers() {
		if (wsHeartbeatInterval) clearInterval(wsHeartbeatInterval);
		wsHeartbeatInterval = null;
	}

	function handleUserOnlineStatusUpdate(userIdToUpdate, isOnline, timestamp) {
		const userTimestamp = timestamp || new Date().toISOString();
		let userChanged = false;
		const convo = appState.conversations.find(c => c.partner_id === userIdToUpdate);
		if (convo) {
			if ((isOnline && (!convo.partner_last_active_ts || new Date(userTimestamp) > new Date(convo.partner_last_active_ts))) || !isOnline) {
				convo.partner_last_active_ts = userTimestamp;
				userChanged = true;
			}
			if (appState.currentConversationId === convo.id && userChanged) { updateChatHeader(convo); }
		}
		const user = appState.users.find(u => u.id === userIdToUpdate);
		if (user) {
			if ((isOnline && (!user.last_active_ts || new Date(userTimestamp) > new Date(user.last_active_ts))) || !isOnline) {
				user.last_active_ts = userTimestamp;
				userChanged = true;
			}
		}
		const adminUser = appState.adminUserList.find(u => u.id === userIdToUpdate);
		if (adminUser) {
			if ((isOnline && (!adminUser.last_active_ts || new Date(userTimestamp) > new Date(adminUser.last_active_ts))) || !isOnline) {
				adminUser.last_active_ts = userTimestamp;
				userChanged = true;
			}
		}
		if (userChanged) {
			renderConversationList();
			if (appState.currentView === 'admin') renderAdminUserList(appState.adminUserList);
			updateActiveStatusUI();
		}
	}

	function handleMessageReadStatusUpdate(conversationId, messageIds, readerId) {
		if (!Array.isArray(messageIds)) messageIds = [messageIds];
		const messagesInConv = appState.messages.get(conversationId);
		if (!messagesInConv || readerId === appState.currentUser?.id) return;
		messageIds.forEach(messageId => {
			const msgIndex = messagesInConv.findIndex(m => m.id === messageId);
			if (msgIndex > -1) {
				if (messagesInConv[msgIndex].sender_id === appState.currentUser?.id && !messagesInConv[msgIndex].isReadByPartner) {
					messagesInConv[msgIndex].isReadByPartner = true;
					const messageEl = dom.messageArea?.querySelector(`.message[data-message-id="${messageId}"]`);
					if (messageEl) updateMessageReadStatusUI(messageEl, true);
				}
			}
		});
	}

	function attachEventListeners() {
		dom.onboardingForm?.addEventListener('submit', handleOnboardingSubmit);
		dom.onboardingSubmit?.addEventListener('click', () => dom.onboardingForm?.requestSubmit ? dom.onboardingForm.requestSubmit() : dom.onboardingForm?.submit());
		dom.userLoginForm?.addEventListener('submit', handleUserLoginSubmit);
		dom.loginSubmit?.addEventListener('click', () => dom.userLoginForm?.requestSubmit ? dom.userLoginForm.requestSubmit() : dom.userLoginForm?.submit());
		dom.adminLoginForm?.addEventListener('submit', handleAdminLoginSubmit);
		dom.adminLoginSubmit?.addEventListener('click', () => dom.adminLoginForm?.requestSubmit ? dom.adminLoginForm.requestSubmit() : dom.adminLoginForm?.submit());

		dom.userLoginTab?.addEventListener('click', showUserLoginForm);
		dom.adminLoginTab?.addEventListener('click', showAdminLoginForm);
		dom.switchToUserLoginButtons?.forEach((btn) => btn.addEventListener('click', showUserLoginForm));
		dom.errorBannerClose?.addEventListener('click', hideError);
		dom.confirmYesButton?.addEventListener('click', () => handleConfirmation(true));
		dom.confirmNoButton?.addEventListener('click', () => handleConfirmation(false));
		dom.confirmationModalOverlay?.addEventListener('click', (e) => { if (e.target === dom.confirmationModalOverlay) handleConfirmation(false); });
		document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (dom.confirmationModalOverlay?.style.display !== 'none') { handleConfirmation(false); } else if (appState.editingMessageId) { cancelEdit(); } else if (appState.replyingToMessageId) { cancelReply(); } else if (dom.manageBlocksModal?.style.display !== 'none') { closeManageBlocksModal(); } else if (dom.emojiPanel?.style.display !== 'none') { hideEmojiPanel(); } else if (isMobileView() && dom.body.classList.contains('left-panel-active')) { closeMobilePanel(); } } });
		dom.logoutButton?.addEventListener('click', logout);
		dom.manageBlocksButton?.addEventListener('click', openManageBlocksModal);
		dom.themeToggleButton?.addEventListener('click', handleThemeToggle);
		dom.conversationSearchProxy?.addEventListener('input', debounce(renderConversationList, 250));
		dom.mobileMenuToggle?.addEventListener('click', handleMobileMenuToggle);
		dom.mobilePlaceholderMenuToggle?.addEventListener('click', handleMobileMenuToggle);
		dom.panelOverlay?.addEventListener('click', closeMobilePanel);

		dom.sendButton?.addEventListener('mousedown', (e) => { if (isTouchDevice()) { e.preventDefault(); } });
		dom.sendButton?.addEventListener('click', handleSendMessage);
		dom.messageInputProxy?.addEventListener('keydown', handleMessageInputKeyDown);
		dom.messageInputProxy?.addEventListener('input', () => { updateSendButtonState(); });

		dom.refreshMessagesButton?.addEventListener('click', () => { if (appState.currentConversationId && !appState.isLoading.messages && !appState.isLoading.olderMessages) { fetchMessagesForConversation(appState.currentConversationId, true); } });
		dom.blockUserButton?.addEventListener('click', handleBlockUserFromHeader);
		dom.cancelReplyButton?.addEventListener('click', cancelReply);
		dom.manageBlocksModal?.querySelector('.modal-close-button')?.addEventListener('click', () => closeManageBlocksModal(null));
		dom.manageBlocksModal?.addEventListener('click', (e) => { if (e.target === dom.manageBlocksModal && !e.target.closest('.glass-panel')) closeManageBlocksModal(e); });

		dom.adminLogoutButton?.addEventListener('click', logout);
		dom.adminAddUserForm?.addEventListener('submit', handleAdminAddUserSubmit);
		dom.adminAddUserButton?.addEventListener('click', () => dom.adminAddUserForm?.requestSubmit ? dom.adminAddUserForm.requestSubmit() : dom.adminAddUserForm?.submit());
		dom.adminThemeToggleButton?.addEventListener('click', handleThemeToggle);

		dom.emojiToggleButton?.addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiPanel(); });
		document.addEventListener('click', (e) => { if (dom.emojiPanel?.style.display !== 'none' && !dom.emojiPanel?.contains(e.target) && e.target !== dom.emojiToggleButton && !dom.emojiToggleButton?.contains(e.target)) { hideEmojiPanel(); } });

		document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (appState.currentView === 'chat' || appState.currentView === 'admin')) { updateActiveStatusUI(); if (appState.ws && appState.ws.readyState === WebSocket.OPEN && appState.currentUser) appState.ws.send(JSON.stringify({ type: 'status_update', userId: appState.currentUser.id, status: 'online', timestamp: new Date().toISOString() })); if (appState.currentView === 'chat' && appState.currentConversationId && !appState.isLoading.messages && !appState.isLoading.olderMessages) { fetchNewMessages(appState.currentConversationId); } } else if (document.visibilityState === 'hidden' && appState.ws && appState.ws.readyState === WebSocket.OPEN && appState.currentUser) { appState.ws.send(JSON.stringify({ type: 'status_update', userId: appState.currentUser.id, status: 'background', timestamp: new Date().toISOString() })); } });
		window.addEventListener('resize', () => { if (!isMobileView() && dom.body.classList.contains('left-panel-active')) { closeMobilePanel(); } adjustTextareaHeight(); updateManualLoadButtonVisibility(); });

		dom.manualLoadOlderButton?.addEventListener('click', () => {
			if (appState.currentConversationId) {
				fetchOlderMessages(appState.currentConversationId, true);
			}
		});
	}

	function showUserLoginForm() {
		setFormError('login', null);
		if (dom.adminLoginForm) hideElement(dom.adminLoginForm);
		if (dom.userLoginForm) showElement(dom.userLoginForm);
		dom.adminLoginTab?.classList.remove('active');
		dom.userLoginTab?.classList.add('active');
		dom.adminLoginForm?.classList.remove('active-panel');
		dom.userLoginForm?.classList.add('active-panel');
		if (dom.loginUsername) dom.loginUsername.value = '';
		if (dom.loginUsernameProxy) { dom.loginUsernameProxy.textContent = ''; dom.loginUsernameProxy.classList.remove('has-content'); }
		if (dom.loginPassword) dom.loginPassword.value = '';
		if (dom.loginPasswordProxy) { dom.loginPasswordProxy.textContent = ''; dom.loginPasswordProxy.classList.remove('has-content'); }
		if (dom.loginUsernameProxy) dom.loginUsernameProxy.focus();
	}
	function showAdminLoginForm() {
		setFormError('login', null);
		if (dom.userLoginForm) hideElement(dom.userLoginForm);
		if (dom.adminLoginForm) showElement(dom.adminLoginForm);
		dom.userLoginTab?.classList.remove('active');
		dom.adminLoginTab?.classList.add('active');
		dom.userLoginForm?.classList.remove('active-panel');
		dom.adminLoginForm?.classList.add('active-panel');
		if (dom.adminMasterPassword) dom.adminMasterPassword.value = '';
		if (dom.adminMasterPasswordProxy) { dom.adminMasterPasswordProxy.textContent = ''; dom.adminMasterPasswordProxy.classList.remove('has-content'); }
		if (dom.adminMasterPasswordProxy) dom.adminMasterPasswordProxy.focus();
	}

	attachEventListeners();
	initializeCustomInputs();
	initializeApp();

});

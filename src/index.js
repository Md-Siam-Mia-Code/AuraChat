// src/index.js

// --- IMPORTS ---
import { jsonResponse, handleOptions, sha256, validateInput } from './utils.js';
import { getAppConfig, setAppConfig, isBlocked, getConversationParticipants } from './db.js';
import { generateJwtToken, requireAuth, requireAdminAuth, verifyMasterPassword, verifyJwtToken } from './auth.js'; // Ensure verifyJwtToken is imported

// Define global WebSocket connections map (for simple server, not for DOs)
const wsConnections = new Map(); // Map<userId, Set<WebSocket>>

// --- WORKER EXPORT ---
export default {
	async fetch(request, env, ctx) {
		// Initial Checks
		if (!env.DB) {
			console.error('FATAL: DB binding missing.');
			return jsonResponse({ error: 'Database configuration error.' }, 500, {}, env);
		}
		if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
			console.error('FATAL: JWT_SECRET missing or too short. Ensure it is set in your Worker environment variables.');
			if (env.ENVIRONMENT !== 'development') { // Stricter check for production
				return jsonResponse({ error: 'Authentication configuration error. JWT_SECRET is not properly configured on the server.' }, 500, {}, env);
			}
		}

		const url = new URL(request.url);

		// WebSocket upgrade
		const upgradeHeader = request.headers.get('Upgrade');
		if (url.pathname === '/ws' && upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
			const { 0: client, 1: server } = new WebSocketPair();
			await this.handleWebSocketSession(server, env); // Pass server-side socket and env
			return new Response(null, { status: 101, webSocket: client });
		}


		try {
			if (request.method === 'OPTIONS') { return handleOptions(request, env); }
			if (url.pathname.startsWith('/api/')) { return this.handleApiRequest(request, env, ctx, url); }
			if (request.method === 'GET') {
				if (!env.ASSET_HANDLER || typeof env.ASSET_HANDLER.fetch !== 'function') {
					console.error("env.ASSET_HANDLER missing/invalid.");
					return jsonResponse({ error: 'Static asset configuration error.' }, 500, {}, env);
				}
				try {
					return await env.ASSET_HANDLER.fetch(request);
				} catch (e) {
					console.error(`Asset Handler Error:`, e);
					return new Response('Error serving assets.', { status: 500 });
				}
			}
			console.log(`Unhandled request: ${request.method} ${url.pathname}`);
			return jsonResponse({ error: 'Not Found' }, 404, {}, env);
		} catch (error) {
			console.error(`Worker fetch top-level error:`, error, error.stack);
			return jsonResponse({ error: 'Internal Server Error' }, 500, {}, env);
		}
	},

	async handleWebSocketSession(ws, env) {
		ws.accept();
		let currentUserId = null;
		console.log("WebSocket connection accepted from server-side.");

		ws.addEventListener('message', async (event) => {
			try {
				const data = JSON.parse(event.data);
				console.log("WS received from client:", data);

				if (data.type === 'authenticate') {
					if (data.token) {
						const authPayload = await verifyJwtToken(data.token, env); // Using the new function
						if (authPayload) {
							currentUserId = authPayload.userId;
							if (!wsConnections.has(currentUserId)) {
								wsConnections.set(currentUserId, new Set());
							}
							wsConnections.get(currentUserId).add(ws);
							console.log(`WS User ${currentUserId} authenticated and connection stored.`);
							ws.send(JSON.stringify({ type: 'authenticated', userId: currentUserId }));
						} else {
							console.warn("WS Authentication failed: Invalid token.");
							ws.send(JSON.stringify({ type: 'auth_failed', error: 'Invalid token' }));
							ws.close(1008, "Invalid token");
						}
					} else {
						console.warn("WS Authentication attempt without token.");
						ws.send(JSON.stringify({ type: 'auth_failed', error: 'Token required' }));
						ws.close(1008, "Token required");
					}
					return; // Don't process further if not authenticated
				}

				if (!currentUserId) {
					console.warn("WS message received before authentication.");
					ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
					return;
				}

				switch (data.type) {
					case 'ping':
						ws.send(JSON.stringify({ type: 'pong', userId: currentUserId }));
						// Consider updating last_active_ts here as well for WS activity
						if (env.DB && currentUserId) {
							await env.DB.prepare('UPDATE users SET last_active_ts = ?1 WHERE id = ?2')
								.bind(new Date().toISOString(), currentUserId)
								.run().catch(e => console.error("WS Ping: Error updating last_active_ts", e));
						}
						break;
					case 'status_update':
						if (env.DB && data.userId && data.status && data.timestamp) {
							const statusMap = { 'online': data.timestamp, 'background': data.timestamp, 'offline': data.timestamp };
							if (statusMap[data.status]) {
								await env.DB.prepare('UPDATE users SET last_active_ts = ?1 WHERE id = ?2')
									.bind(statusMap[data.status], data.userId)
									.run().catch(e => console.error("WS Status Update: Error updating last_active_ts", e));
								console.log(`User ${data.userId} status updated to ${data.status} at ${statusMap[data.status]} via WS.`);
								// Broadcast to relevant users
								broadcastUserStatus(data.userId, data.status === 'online', statusMap[data.status], currentUserId); // currentUserId is the sender to avoid sending back
							}
						}
						break;
					case 'mark_read':
						if (env.DB && data.conversationId && Array.isArray(data.messageIds) && data.readerId) {
							const { conversationId, messageIds, readerId } = data;
							const batchStmts = messageIds.map(msgId =>
								env.DB.prepare('INSERT OR IGNORE INTO message_read_status (message_id, user_id) VALUES (?1, ?2)')
									.bind(msgId, readerId)
							);
							await env.DB.batch(batchStmts).catch(e => console.error("WS Mark Read: DB batch error", e));
							console.log(`WS: Messages ${messageIds.join(', ')} in convo ${conversationId} marked as read by ${readerId}.`);

							const participants = await getConversationParticipants(env.DB, conversationId, readerId);
							participants.forEach(participantId => {
								broadcastToUser(participantId, { type: 'message_read', conversationId, messageIds, readerId });
							});
						}
						break;
				}
			} catch (e) {
				console.error('WS Error processing message:', e, event.data);
				ws.send(JSON.stringify({ type: 'error', message: 'Failed to process message' }));
			}
		});

		ws.addEventListener('close', (event) => {
			console.log(`WS Connection closed for user ${currentUserId}:`, event.code, event.reason);
			if (currentUserId && wsConnections.has(currentUserId)) {
				wsConnections.get(currentUserId).delete(ws);
				if (wsConnections.get(currentUserId).size === 0) {
					wsConnections.delete(currentUserId);
					console.log(`User ${currentUserId} fully disconnected. Updating last_active_ts.`);
					if (env.DB) {
						env.DB.prepare('UPDATE users SET last_active_ts = ?1 WHERE id = ?2')
							.bind(new Date().toISOString(), currentUserId) // Set last seen to now on disconnect
							.run().catch(e => console.error("WS Close: Error updating last_active_ts", e));
						// Broadcast offline status
						broadcastUserStatus(currentUserId, false, new Date().toISOString(), null); // null so everyone gets it if needed
					}
				}
			}
			currentUserId = null;
		});
		ws.addEventListener('error', (err) => {
			console.error(`WS Error for user ${currentUserId}:`, err);
		});
	},

	async handleApiRequest(request, env, ctx, url) {
		const path = url.pathname.replace('/api/', '');
		const pathSegments = path.split('/').filter(Boolean);
		const method = request.method;
		console.log(`API Request: ${method} /api/${path}`);
		let body = null;
		try {
			if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT') {
				try { if (request.headers.get("content-length") !== "0" && request.headers.get("content-type")?.includes("application/json")) { body = await request.json(); } }
				catch (e) { return jsonResponse({ error: 'Invalid JSON body provided.' }, 400, {}, env); }
			}
			if (method === 'GET' && path === 'setup/status') { const adminCreated = await getAppConfig(env.DB, 'admin_created'); return jsonResponse({ adminExists: adminCreated === 'true' }, 200, {}, env); }
			if (method === 'POST' && path === 'setup/admin') { const adminCreated = await getAppConfig(env.DB, 'admin_created'); if (adminCreated === 'true') return jsonResponse({ error: 'Admin account already exists.' }, 409, {}, env); const validationError = validateInput(body, ['username', 'password', 'masterPassword']); if (validationError) return jsonResponse({ error: validationError }, 400, {}, env); const username = body.username.trim(); const password = body.password; const masterPassword = body.masterPassword; if (username.length < 3 || password.length < 8 || masterPassword.length < 10) { return jsonResponse({ error: 'Input field length requirements not met.' }, 400, {}, env); } const passwordHash = await sha256(password); const masterPasswordHash = await sha256(masterPassword); const results = await env.DB.batch([env.DB.prepare('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?1, ?2, 1, ?3)').bind(username, passwordHash, new Date().toISOString()), env.DB.prepare('INSERT OR REPLACE INTO app_config (config_key, config_value) VALUES (?1, ?2)').bind('master_password_hash', masterPasswordHash), env.DB.prepare('INSERT OR REPLACE INTO app_config (config_key, config_value) VALUES (?1, ?2)').bind('admin_created', 'true'),]); if (results.every((r) => r.success)) { return jsonResponse({ success: true }, 201, {}, env); } else { console.error('Admin setup batch failed:', results); throw new Error('Failed to complete admin setup.'); } }
			if (method === 'POST' && path === 'auth/login') { const validationError = validateInput(body, ['username', 'password']); if (validationError) return jsonResponse({ error: validationError }, 400, {}, env); const user = await env.DB.prepare('SELECT id, username, password_hash, is_admin FROM users WHERE username = ?1 COLLATE NOCASE').bind(body.username).first(); if (!user || user.is_admin) return jsonResponse({ error: 'Invalid credentials.' }, 401, {}, env); const passwordHash = await sha256(body.password); if (passwordHash !== user.password_hash) return jsonResponse({ error: 'Invalid credentials.' }, 401, {}, env); const token = await generateJwtToken(env, user.id, user.username, false); ctx.waitUntil(env.DB.prepare('UPDATE users SET last_active_ts = ?1 WHERE id = ?2').bind(new Date().toISOString(), user.id).run().then(() => broadcastUserStatus(user.id, true, new Date().toISOString(), null)).catch((e) => console.error(`Failed last_active update on login for user ${user.id}:`, e))); return jsonResponse({ success: true, token, user: { id: user.id, username: user.username, isAdmin: false } }, 200, {}, env); }
			if (method === 'POST' && path === 'auth/admin/login') { const validationError = validateInput(body, ['masterPassword']); if (validationError) return jsonResponse({ error: validationError }, 400, {}, env); const isValid = await verifyMasterPassword(env.DB, body.masterPassword); if (!isValid) return jsonResponse({ error: 'Invalid master password.' }, 401, {}, env); const adminUser = await env.DB.prepare('SELECT id, username FROM users WHERE is_admin = 1 LIMIT 1').first(); if (!adminUser) { return jsonResponse({ error: 'Admin account configuration error.' }, 500, {}, env); } const token = await generateJwtToken(env, adminUser.id, adminUser.username, true); ctx.waitUntil(env.DB.prepare('UPDATE users SET last_active_ts = ?1 WHERE id = ?2').bind(new Date().toISOString(), adminUser.id).run().then(() => broadcastUserStatus(adminUser.id, true, new Date().toISOString(), null)).catch((e) => console.error(`Failed last_active update on admin login for user ${adminUser.id}:`, e))); return jsonResponse({ success: true, token, user: { id: adminUser.id, username: adminUser.username, isAdmin: true } }, 200, {}, env); }

			if (method === 'GET' && path === 'users') { return await requireAuth(request, env, ctx, async (req) => { const userId = req.auth.userId; const query = `SELECT u.id, u.username, u.last_active_ts FROM users u WHERE u.id != ?1 AND u.is_admin = 0 AND NOT EXISTS ( SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ?2) OR (b.blocker_id = ?3 AND b.blocked_id = u.id)) ORDER BY u.username COLLATE NOCASE ASC;`; const { results } = await env.DB.prepare(query).bind(userId, userId, userId).all(); return jsonResponse(results || [], 200, {}, env); }); }
			if (method === 'GET' && path === 'conversations') { return await requireAuth(request, env, ctx, async (req) => { const userId = req.auth.userId; const query = ` WITH LatestMessage AS ( SELECT m.conversation_id, m.content, m.timestamp, m.sender_id, u_sender.username as sender_username, ROW_NUMBER() OVER(PARTITION BY m.conversation_id ORDER BY m.timestamp DESC) as rn FROM messages m JOIN users u_sender ON m.sender_id = u_sender.id ), PartnerInfo AS ( SELECT cp.conversation_id, p.id as partner_id, p.username as partner_username, p.last_active_ts as partner_last_active_ts FROM conversation_participants cp JOIN users p ON cp.user_id = p.id WHERE cp.conversation_id IN (SELECT cp_inner.conversation_id FROM conversation_participants cp_inner WHERE cp_inner.user_id = ?1) AND cp.user_id != ?2 ) SELECT c.id, c.last_activity_ts, lm.content as last_message_content, lm.timestamp as last_message_ts, lm.sender_username as last_message_sender, (SELECT COUNT(*) FROM messages m_unread WHERE m_unread.conversation_id = c.id AND m_unread.sender_id != ?3 AND NOT EXISTS (SELECT 1 FROM message_read_status mrs WHERE mrs.message_id = m_unread.id AND mrs.user_id = ?4)) as unread_count, pi.partner_id, pi.partner_username, pi.partner_last_active_ts FROM conversations c JOIN conversation_participants self_cp ON c.id = self_cp.conversation_id AND self_cp.user_id = ?5 JOIN PartnerInfo pi ON c.id = pi.conversation_id LEFT JOIN LatestMessage lm ON c.id = lm.conversation_id AND lm.rn = 1 WHERE NOT EXISTS ( SELECT 1 FROM blocks b WHERE (b.blocker_id = pi.partner_id AND b.blocked_id = self_cp.user_id) ) ORDER BY c.last_activity_ts DESC; `; const { results } = await env.DB.prepare(query).bind(userId, userId, userId, userId, userId).all(); return jsonResponse(results || [], 200, {}, env); }); }
			if (method === 'POST' && path === 'conversations') { return await requireAuth(request, env, ctx, async (req) => { const userId = req.auth.userId; if (typeof body?.partnerId !== 'number' || !Number.isInteger(body.partnerId) || body.partnerId <= 0) { return jsonResponse({ error: 'Partner ID must be a positive integer.' }, 400, {}, env); } const partnerId = body.partnerId; if (partnerId === userId) return jsonResponse({ error: 'Cannot start a conversation with yourself.' }, 400, {}, env); const partner = await env.DB.prepare('SELECT id, is_admin from users where id = ?1').bind(partnerId).first(); if (!partner) return jsonResponse({ error: 'Partner user not found.' }, 404, {}, env); if (partner.is_admin) return jsonResponse({ error: 'Cannot start conversation with an admin.' }, 403, {}, env); const existingConv = await env.DB.prepare(`SELECT p1.conversation_id FROM conversation_participants p1 INNER JOIN conversation_participants p2 ON p1.conversation_id = p2.conversation_id WHERE p1.user_id = ?1 AND p2.user_id = ?2 LIMIT 1`).bind(userId, partnerId).first('conversation_id'); if (existingConv) { return jsonResponse({ success: true, conversationId: existingConv, existed: true }, 200, {}, env); } if ((await isBlocked(env.DB, partnerId, userId)) || (await isBlocked(env.DB, userId, partnerId))) { return jsonResponse({ error: 'Cannot start chat due to blocking.' }, 403, {}, env); } let newConversationId = null; try { const now = new Date().toISOString(); const result = await env.DB.prepare('INSERT INTO conversations (creator_id, last_activity_ts) VALUES (?1, ?2) RETURNING id').bind(userId, now).first(); if (!result || typeof result.id !== 'number') { throw new Error('Failed to create conversation row or retrieve ID.'); } newConversationId = result.id; const batchResult = await env.DB.batch([env.DB.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?1, ?2)').bind(newConversationId, userId), env.DB.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?1, ?2)').bind(newConversationId, partnerId),]); if (!batchResult.every((r) => r.success)) { console.error(`Failed to add participants for new convo ${newConversationId}:`, batchResult); await env.DB.prepare('DELETE FROM conversations WHERE id = ?1').bind(newConversationId).run().catch(cleanErr => console.error(`Cleanup failed convo ${newConversationId}:`, cleanErr)); throw new Error('Failed to add participants.'); } return jsonResponse({ success: true, conversationId: newConversationId, existed: false }, 201, {}, env); } catch (e) { console.error(`Error creating conversation between ${userId} and ${partnerId}:`, e); if (newConversationId && e.message?.includes('Failed to add participants')) { await env.DB.prepare('DELETE FROM conversations WHERE id = ?1').bind(newConversationId).run().catch((err) => console.error('Cleanup failed:', err)); } throw new Error('Failed to start conversation.'); } }); }
			if (method === 'GET' && pathSegments.length === 3 && pathSegments[0] === 'conversations' && pathSegments[2] === 'messages') { return await requireAuth(request, env, ctx, async (req) => { const conversationId = parseInt(pathSegments[1], 10); const sinceTimestamp = url.searchParams.get('since'); const beforeTimestamp = url.searchParams.get('before_ts'); const initialLoadLimit = 50; const loadOlderLimit = 30; if (isNaN(conversationId) || conversationId <= 0) return jsonResponse({ error: 'Invalid conversation ID.' }, 400, {}, env); const userId = req.auth.userId; const participantCheck = await env.DB.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2').bind(conversationId, userId).first(); if (!participantCheck) return jsonResponse({ error: 'Forbidden: Not a participant.' }, 403, {}, env); const participants = await getConversationParticipants(env.DB, conversationId); const partnerId = participants.find((pId) => pId !== userId); if (partnerId && (await isBlocked(env.DB, partnerId, userId))) { return jsonResponse({ error: 'Blocked by partner.' }, 403, {}, env); } const isReadSubqueryPartnerId = partnerId ?? -1; const baseSelect = ` SELECT m.id, m.content, m.timestamp, m.sender_id, u.username as sender_username, m.conversation_id, m.is_edited, m.edited_at, m.reply_to_message_id, reply_msg.content as reply_snippet, reply_sender.username as reply_sender_username, CASE WHEN m.sender_id = ?1 AND EXISTS (SELECT 1 FROM message_read_status mrs WHERE mrs.message_id = m.id AND mrs.user_id = ?2) THEN 1 ELSE 0 END as isReadByPartner FROM messages m JOIN users u ON m.sender_id = u.id LEFT JOIN messages reply_msg ON m.reply_to_message_id = reply_msg.id LEFT JOIN users reply_sender ON reply_msg.sender_id = reply_sender.id `; let query = ''; const params = [userId, isReadSubqueryPartnerId, conversationId]; if (sinceTimestamp) { if (isNaN(new Date(sinceTimestamp).getTime())) return jsonResponse({ error: "Invalid 'since' timestamp format." }, 400, {}, env); query = `${baseSelect} WHERE m.conversation_id = ?3 AND m.timestamp > ?4 ORDER BY m.timestamp ASC;`; params.push(sinceTimestamp); } else if (beforeTimestamp) { if (isNaN(new Date(beforeTimestamp).getTime())) return jsonResponse({ error: "Invalid 'before_ts' timestamp format." }, 400, {}, env); query = `${baseSelect} WHERE m.conversation_id = ?3 AND m.timestamp < ?4 ORDER BY m.timestamp DESC LIMIT ?5;`; params.push(beforeTimestamp, loadOlderLimit); } else { query = `${baseSelect} WHERE m.conversation_id = ?3 ORDER BY m.timestamp DESC LIMIT ?4;`; params.push(initialLoadLimit); } const { results } = await env.DB.prepare(query).bind(...params).all(); let messagesData = (results || []).map((msg) => ({ ...msg, isReadByPartner: !!msg.isReadByPartner, is_edited: !!msg.is_edited })); if (!sinceTimestamp) messagesData.reverse(); const receivedMessageIds = messagesData.filter((m) => m.sender_id !== userId).map((m) => m.id); if (receivedMessageIds.length > 0 && !beforeTimestamp) { ctx.waitUntil((async () => { try { const batchStmts = receivedMessageIds.map((msgId) => env.DB.prepare('INSERT OR IGNORE INTO message_read_status (message_id, user_id) VALUES (?1, ?2)').bind(msgId, userId)); await env.DB.batch(batchStmts); if (wsConnections.size > 0) { const participantsToNotify = await getConversationParticipants(env.DB, conversationId, userId); participantsToNotify.forEach(pId => { broadcastToUser(pId, { type: 'message_read', conversationId, messageIds: receivedMessageIds, readerId: userId }) }); } } catch (dbErr) { console.error(`Error marking messages read for user ${userId}, convo ${conversationId}:`, dbErr); } })()); } return jsonResponse(messagesData, 200, {}, env); }); }
			if (method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'conversations' && pathSegments[2] === 'messages') { return await requireAuth(request, env, ctx, async (req) => { const conversationId = parseInt(pathSegments[1], 10); if (isNaN(conversationId) || conversationId <= 0) return jsonResponse({ error: 'Invalid Conversation ID.' }, 400, {}, env); const userId = req.auth.userId; const username = req.auth.username; const validationError = validateInput(body, ['content']); if (validationError) return jsonResponse({ error: validationError }, 400, {}, env); const content = body.content.trim(); const replyToMessageId = body.reply_to_message_id ? parseInt(body.reply_to_message_id, 10) : null; if (!content || content.length > 1000) return jsonResponse({ error: 'Content required (1-1000 chars).' }, 400, {}, env); if (replyToMessageId !== null && (isNaN(replyToMessageId) || replyToMessageId <= 0)) { return jsonResponse({ error: 'Invalid reply_to_message_id.' }, 400, {}, env); } const participants = await getConversationParticipants(env.DB, conversationId); if (!participants.includes(userId)) return jsonResponse({ error: 'Forbidden: Not a participant.' }, 403, {}, env); const partnerId = participants.find((pId) => pId !== userId); if (partnerId && ((await isBlocked(env.DB, userId, partnerId)) || (await isBlocked(env.DB, partnerId, userId)))) { return jsonResponse({ error: 'Cannot send message due to blocking.' }, 403, {}, env); } if (replyToMessageId) { const repliedMsgExists = await env.DB.prepare('SELECT 1 FROM messages WHERE id = ?1 AND conversation_id = ?2').bind(replyToMessageId, conversationId).first(); if (!repliedMsgExists) return jsonResponse({ error: 'Message being replied to not found in this conversation.' }, 404, {}, env); } const now = new Date().toISOString(); let newMessageId = null; try { const result = await env.DB.prepare('INSERT INTO messages (conversation_id, sender_id, content, timestamp, reply_to_message_id) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id').bind(conversationId, userId, content, now, replyToMessageId).first(); if (!result || typeof result.id !== 'number') { throw new Error('Failed to insert message or retrieve ID.'); } newMessageId = result.id; ctx.waitUntil(env.DB.prepare('UPDATE conversations SET last_activity_ts = ?1 WHERE id = ?2').bind(now, conversationId).run().catch((err) => console.error(`Failed update convo ts ${conversationId}:`, err))); const fetchStmt = env.DB.prepare(` SELECT m.id, m.content, m.timestamp, m.sender_id, ?4 as sender_username, m.conversation_id, m.is_edited, m.edited_at, m.reply_to_message_id, reply_msg.content as reply_snippet, reply_sender.username as reply_sender_username FROM messages m LEFT JOIN messages reply_msg ON m.reply_to_message_id = reply_msg.id LEFT JOIN users reply_sender ON reply_msg.sender_id = reply_sender.id WHERE m.id = ?1 AND m.conversation_id = ?2 AND m.sender_id = ?3`); const newMessageData = await fetchStmt.bind(newMessageId, conversationId, userId, username).first(); if (!newMessageData) { throw new Error('Failed to retrieve newly inserted message.'); } const finalMessageObject = { ...newMessageData, isReadByPartner: false, is_edited: false }; participants.filter(pId => pId !== userId).forEach(pId => { broadcastToUser(pId, { type: 'new_message', message: finalMessageObject, conversationId: conversationId }); }); return jsonResponse({ success: true, message: finalMessageObject }, 201, {}, env); } catch (e) { console.error(`Error sending msg user ${userId} convo ${conversationId}:`, e); if (newMessageId) { await env.DB.prepare("DELETE FROM messages WHERE id = ?1").bind(newMessageId).run().catch(delErr => console.error(`Failed cleanup for partially failed message send ${newMessageId}:`, delErr)); } throw new Error('Failed to send message.'); } }); }
			if (method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'conversations' && pathSegments[2] === 'read') { return await requireAuth(request, env, ctx, async (req) => { const conversationId = parseInt(pathSegments[1], 10); if (isNaN(conversationId) || conversationId <= 0) return jsonResponse({ error: 'Invalid conversation ID.' }, 400, {}, env); const userId = req.auth.userId; const participantCheck = await env.DB.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2').bind(conversationId, userId).first(); if (!participantCheck) return jsonResponse({ error: 'Forbidden: Not a participant.' }, 403, {}, env); const messageIdsToMark = body?.message_ids; if (!Array.isArray(messageIdsToMark) || messageIdsToMark.some(id => isNaN(parseInt(id, 10)))) { return jsonResponse({ error: 'Invalid message_ids provided.' }, 400, {}, env); } if (messageIdsToMark.length === 0) { return jsonResponse({ success: true, message: "No messages to mark." }, 200, {}, env); } const placeholders = messageIdsToMark.map(() => '?').join(','); const stmt = env.DB.prepare(` INSERT OR IGNORE INTO message_read_status (message_id, user_id) SELECT m.id, ?1 FROM messages m WHERE m.conversation_id = ?2 AND m.sender_id != ?1 AND m.id IN (${placeholders}) `); ctx.waitUntil((async () => { try { const bindParams = [userId, conversationId, ...messageIdsToMark]; const { success, meta } = await stmt.bind(...bindParams).run(); if (success && meta.changes > 0) { const participantsToNotify = await getConversationParticipants(env.DB, conversationId, userId); participantsToNotify.forEach(pId => { broadcastToUser(pId, { type: 'message_read', conversationId, messageIds: messageIdsToMark, readerId: userId }); }); console.log(`Marked ${meta.changes} msgs as read by user ${userId} via /read endpoint for convo ${conversationId}`); } else if (!success) { console.error(`DB error marking messages read via /read for user ${userId}, convo ${conversationId}`); } } catch (dbErr) { console.error(`Error executing mark messages read via /read endpoint:`, dbErr); } })()); return jsonResponse({ success: true }, 200, {}, env); }); }
			if (method === 'PATCH' && pathSegments.length === 2 && pathSegments[0] === 'messages') { return await requireAuth(request, env, ctx, async (req) => { const messageId = parseInt(pathSegments[1], 10); if (isNaN(messageId) || messageId <= 0) return jsonResponse({ error: 'Invalid message ID.' }, 400, {}, env); const userId = req.auth.userId; const validationError = validateInput(body, ['content']); if (validationError) return jsonResponse({ error: validationError }, 400, {}, env); const newContent = body.content.trim(); if (!newContent || newContent.length > 1000) return jsonResponse({ error: 'Content required (1-1000 chars).' }, 400, {}, env); const originalMessage = await env.DB.prepare('SELECT sender_id, conversation_id, timestamp, content FROM messages WHERE id = ?1').bind(messageId).first(); if (!originalMessage) return jsonResponse({ error: 'Message not found.' }, 404, {}, env); if (originalMessage.sender_id !== userId) { return jsonResponse({ error: 'Forbidden: You can only edit your own messages.' }, 403, {}, env); } if (newContent === originalMessage.content) { return jsonResponse({ success: true, message: "No changes detected." }, 200, {}, env); } const now = new Date().toISOString(); const { success, meta } = await env.DB.prepare('UPDATE messages SET content = ?1, is_edited = 1, edited_at = ?2 WHERE id = ?3 AND sender_id = ?4').bind(newContent, now, messageId, userId).run(); if (success && meta.changes > 0) { console.log(`User ${userId} edited message ${messageId}`); ctx.waitUntil(env.DB.prepare(`UPDATE conversations SET last_activity_ts = ?1 WHERE id = ?2 AND (SELECT MAX(m.timestamp) FROM messages m WHERE m.conversation_id = ?2) = ?3`).bind(now, originalMessage.conversation_id, originalMessage.conversation_id, originalMessage.timestamp).run().catch((err) => console.error(`Failed update convo ts on edit ${originalMessage.conversation_id}:`, err))); return jsonResponse({ success: true, edited_at: now }, 200, {}, env); } else if (success) { return jsonResponse({ error: 'Message not found or not owned by user.' }, 404, {}, env); } else { console.error(`Failed to update message ${messageId} for user ${userId}`); throw new Error('Failed to update message.'); } }); }
			if (method === 'DELETE' && pathSegments.length === 2 && pathSegments[0] === 'messages') { return await requireAuth(request, env, ctx, async (req) => { const messageId = parseInt(pathSegments[1], 10); if (isNaN(messageId) || messageId <= 0) return jsonResponse({ error: 'Invalid message ID.' }, 400, {}, env); const userId = req.auth.userId; const originalMessage = await env.DB.prepare('SELECT sender_id, conversation_id FROM messages WHERE id = ?1').bind(messageId).first(); if (!originalMessage) return jsonResponse({ error: 'Message not found.' }, 404, {}, env); if (originalMessage.sender_id !== userId) { return jsonResponse({ error: 'Forbidden: You can only delete your own messages.' }, 403, {}, env); } const { success, meta } = await env.DB.prepare('DELETE FROM messages WHERE id = ?1 AND sender_id = ?2').bind(messageId, userId).run(); if (success && meta.changes > 0) { console.log(`User ${userId} deleted message ${messageId}`); return new Response(null, { status: 204 }); } else if (success) { return jsonResponse({ error: 'Message not found or not owned by user.' }, 404, {}, env); } else { console.error(`Failed to delete message ${messageId} for user ${userId}`); throw new Error('Failed to delete message.'); } }); }
			if (method === 'GET' && path === 'blocks') { return await requireAuth(request, env, ctx, async (req) => { const userId = req.auth.userId; const { results } = await env.DB.prepare(`SELECT u.id, u.username FROM blocks b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = ?1 ORDER BY u.username COLLATE NOCASE ASC`).bind(userId).all(); return jsonResponse(results || [], 200, {}, env); }); }
			if (method === 'POST' && path === 'blocks') { return await requireAuth(request, env, ctx, async (req) => { const userId = req.auth.userId; if (typeof body?.userId !== 'number' || !Number.isInteger(body.userId) || body.userId <= 0) { return jsonResponse({ error: 'Invalid user ID to block.' }, 400, {}, env); } const blockedId = body.userId; if (userId === blockedId) return jsonResponse({ error: 'Cannot block yourself.' }, 400, {}, env); const userToBlock = await env.DB.prepare('SELECT id, is_admin, username FROM users WHERE id = ?1').bind(blockedId).first(); if (!userToBlock) return jsonResponse({ error: 'User not found.' }, 404, {}, env); if (userToBlock.is_admin) return jsonResponse({ error: 'Cannot block an administrator.' }, 403, {}, env); const { success, meta } = await env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?1, ?2)').bind(userId, blockedId).run(); if (success) { if (meta.changes > 0) console.log(`User ${userId} blocked user ${userToBlock.username} (ID: ${blockedId})`); return jsonResponse({ success: true }, 201, {}, env); } else { console.error(`Failed to block user ${blockedId} for user ${userId}`); throw new Error('Failed to block user.'); } }); }
			if (method === 'DELETE' && pathSegments.length === 2 && pathSegments[0] === 'blocks') { return await requireAuth(request, env, ctx, async (req) => { const blockerId = req.auth.userId; const blockedIdToUnblock = parseInt(pathSegments[1], 10); if (isNaN(blockedIdToUnblock) || blockedIdToUnblock <= 0) { return jsonResponse({ error: 'Invalid user ID to unblock.' }, 400, {}, env); } const { success, meta } = await env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2').bind(blockerId, blockedIdToUnblock).run(); if (success) { const message = meta.changes > 0 ? 'User unblocked.' : 'User was not blocked by you.'; if (meta.changes > 0) console.log(`User ${blockerId} unblocked user ${blockedIdToUnblock}`); return jsonResponse({ success: true, message: message }, 200, {}, env); } else { console.error(`Failed to unblock user ${blockedIdToUnblock} for user ${blockerId}`); throw new Error('Failed to unblock user.'); } }); }

			else if (path.startsWith('admin/')) {
				if (method === 'GET' && path === 'admin/stats') { return await requireAdminAuth(request, env, ctx, async (req) => { console.log(`Admin stats request by admin ${req.auth.userId} (${req.auth.username})`); const [userCountRes, messageCountRes, convCountRes, activeUsersRes] = await Promise.all([env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 0').first('count'), env.DB.prepare('SELECT COUNT(*) as count FROM messages').first('count'), env.DB.prepare('SELECT COUNT(*) as count FROM conversations').first('count'), (async () => { const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString(); return await env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 0 AND last_active_ts > ?1').bind(fiveMinAgo).first('count'); })()]); return jsonResponse({ userCount: userCountRes ?? 0, messageCount: messageCountRes ?? 0, conversationCount: convCountRes ?? 0, activeUsers: activeUsersRes ?? 0, }, 200, {}, env); }); }
				if (method === 'GET' && path === 'admin/users') { return await requireAdminAuth(request, env, ctx, async (req) => { console.log(`Admin user list request by admin ${req.auth.userId} (${req.auth.username})`); const { results } = await env.DB.prepare('SELECT id, username, created_at, last_active_ts FROM users WHERE is_admin = 0 ORDER BY username COLLATE NOCASE ASC').all(); return jsonResponse(results || [], 200, {}, env); }); }
				if (method === 'POST' && path === 'admin/users') { return await requireAdminAuth(request, env, ctx, async (req) => { const adminUserId = req.auth.userId; const validationError = validateInput(body, ['username', 'password']); if (validationError) return jsonResponse({ error: validationError }, 400, {}, env); const username = body.username.trim(); const password = body.password; if (username.length < 3 || password.length < 8) { return jsonResponse({ error: 'Input field length requirements not met.' }, 400, {}, env); } try { const passwordHash = await sha256(password); const now = new Date().toISOString(); const result = await env.DB.prepare('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?1, ?2, 0, ?3) RETURNING id').bind(username, passwordHash, now).first(); if (result && typeof result.id === 'number') { return jsonResponse({ success: true, userId: result.id }, 201, {}, env); } else { throw new Error('DB Insert failed or did not return ID.'); } } catch (e) { if (e.message?.includes('UNIQUE constraint failed: users.username')) { return jsonResponse({ error: 'Username is already taken.' }, 409, {}, env); } console.error(`Admin ${adminUserId} (${req.auth.username}) failed to create user:`, e); throw e; } }); }
				if (method === 'DELETE' && pathSegments.length === 3 && pathSegments[0] === 'admin' && pathSegments[1] === 'users') { return await requireAdminAuth(request, env, ctx, async (req) => { const adminUserId = req.auth.userId; const userIdToDelete = parseInt(pathSegments[2], 10); if (isNaN(userIdToDelete) || userIdToDelete <= 0) { return jsonResponse({ error: 'Invalid user ID.' }, 400, {}, env); } if (userIdToDelete === adminUserId) { return jsonResponse({ error: 'Cannot delete your own administrator account.' }, 403, {}, env); } const userToDelete = await env.DB.prepare('SELECT id, is_admin, username FROM users WHERE id = ?1').bind(userIdToDelete).first(); if (!userToDelete) return jsonResponse({ error: 'User not found.' }, 404, {}, env); if (userToDelete.is_admin) return jsonResponse({ error: 'Cannot delete another administrator account.' }, 403, {}, env); const { success, meta } = await env.DB.prepare('DELETE FROM users WHERE id = ?1 AND is_admin = 0').bind(userIdToDelete).run(); if (success && meta.changes > 0) { console.log(`Admin ${adminUserId} (${req.auth.username}) deleted user ${userToDelete.username} (ID: ${userIdToDelete})`); return new Response(null, { status: 204 }); } else if (success) { return jsonResponse({ error: 'User not found or could not be deleted.' }, 404, {}, env); } else { console.error(`Admin ${adminUserId} (${req.auth.username}) failed to delete user ${userIdToDelete}`); throw new Error('Failed to delete user.'); } }); }
			}

			return jsonResponse({ error: 'API Endpoint Not Found' }, 404, {}, env);

		} catch (error) {
			console.error(`API Handler Error (${method} /api/${path}):`, error.status, error.message, error.stack);
			if (error instanceof SyntaxError && error.message.includes('JSON')) { return jsonResponse({ error: 'Invalid JSON in request body.' }, 400, {}, env); }
			const status = typeof error.status === 'number' && error.status >= 400 ? error.status : 500;
			const message = status < 500 && error.message ? error.message : 'Internal Server Error.';
			return jsonResponse({ error: message }, status, {}, env);
		}
	},
};

// Helper function to broadcast messages to a specific user's WebSocket connections
function broadcastToUser(userId, message) {
	const userConnections = wsConnections.get(userId);
	if (userConnections) {
		const messageString = JSON.stringify(message);
		userConnections.forEach(ws => {
			if (ws.readyState === WebSocket.OPEN) {
				try { ws.send(messageString); } catch (e) { console.error("Error sending WS message to user", userId, e); }
			}
		});
	}
}

// Helper to broadcast user status to all relevant connections (e.g., users in shared convos)
// This is a simplified broadcast for now. For production, you'd want a more targeted broadcast.
function broadcastUserStatus(updatedUserId, isOnline, timestamp, skipUserId = null) {
	// Example: iterate all connections and send if not the user themselves or the skipped user
	wsConnections.forEach((userConnectionSet, userId) => {
		if (userId !== updatedUserId && userId !== skipUserId) {
			userConnectionSet.forEach(ws => {
				if (ws.readyState === WebSocket.OPEN) {
					try {
						ws.send(JSON.stringify({
							type: isOnline ? 'user_online' : 'user_offline',
							userId: updatedUserId,
							timestamp: timestamp
						}));
					} catch (e) {
						console.error("Error broadcasting user status:", e);
					}
				}
			});
		}
	});
}

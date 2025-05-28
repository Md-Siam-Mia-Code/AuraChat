// src/db.js

/** Fetches a specific configuration value */
export async function getAppConfig(db, key) {
	if (!db) { console.error('DB missing in getAppConfig'); return null; }
	if (!key) { console.error('Config key missing in getAppConfig'); return null; }
	try {
		const stmt = db.prepare('SELECT config_value FROM app_config WHERE config_key = ?1 LIMIT 1');
		const result = await stmt.bind(key).first('config_value');
		return result ?? null;
	} catch (e) { console.error(`Error getting app config for key '${key}':`, e); return null; }
}

/** Sets or updates a configuration value */
export async function setAppConfig(db, key, value) {
	if (!db) { console.error('DB missing in setAppConfig'); return false; }
    if (!key || value === undefined || value === null) { console.error(`Invalid key/value for setAppConfig: key=${key}`); return false; }
	try {
		const stmt = db.prepare('INSERT OR REPLACE INTO app_config (config_key, config_value) VALUES (?1, ?2)');
		const { success } = await stmt.bind(key, String(value)).run();
		if (!success) { console.error(`D1 statement failed for setAppConfig key '${key}'.`); }
		return success;
	} catch (e) { console.error(`Error setting app config for key '${key}':`, e); return false; }
}

/** Checks if a user is blocked by another */
export async function isBlocked(db, potentialBlockerId, potentialBlockedId) {
	if (!db || !potentialBlockerId || !potentialBlockedId) { console.warn("isBlocked check skipped: Missing db or IDs."); return false; }
    if (potentialBlockerId === potentialBlockedId) { return false; } // Cannot block self
	try {
		const stmt = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2 LIMIT 1');
		const result = await stmt.bind(potentialBlockerId, potentialBlockedId).first();
		return !!result;
	} catch (e) { console.error(`Error checking block status ${potentialBlockerId}->${potentialBlockedId}:`, e); return false; }
}

/** Retrieves participants of a conversation */
export async function getConversationParticipants(db, conversationId, excludeUserId = null) {
	if (!db || !conversationId || isNaN(conversationId) || conversationId <= 0) { console.warn("getConversationParticipants skipped: Missing db or invalid conversationId."); return []; }
	try {
		let query = 'SELECT user_id FROM conversation_participants WHERE conversation_id = ?1';
		const params = [conversationId];
		if (excludeUserId !== null && typeof excludeUserId === 'number' && Number.isInteger(excludeUserId) && excludeUserId > 0) { query += ' AND user_id != ?2'; params.push(excludeUserId); }
		const stmt = db.prepare(query);
		const { results } = await stmt.bind(...params).all();
		return results ? results.map((row) => row.user_id) : [];
	} catch (e) { console.error(`Error getting participants for conversation ${conversationId}:`, e); return []; }
}

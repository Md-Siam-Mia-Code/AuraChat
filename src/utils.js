// src/utils.js

export async function sha256(str) {
	try {
		const buffer = new TextEncoder().encode(str);
		const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	} catch (error) {
		console.error('FATAL: sha256 hashing failed:', error);
		throw new Error('Hashing failed internally.');
	}
}

export function jsonResponse(body, status = 200, headers = {}, env = null) {
	const allowedOrigin = (env && env.FRONTEND_ORIGIN && env.ENVIRONMENT !== 'development')
		? env.FRONTEND_ORIGIN
		: '*'; // Default to '*' for local dev or if FRONTEND_ORIGIN not set

	const defaultCorsHeaders = {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Ensure Authorization is allowed for JWT
		'Access-Control-Max-Age': '86400', // 1 day
	};
	const finalHeaders = { ...defaultCorsHeaders, ...headers, 'Content-Type': 'application/json' };
	return new Response(JSON.stringify(body), { status, headers: finalHeaders });
}

export function handleOptions(request, env = null) { // env parameter
	let reqHeaders = request.headers;
	if (
		reqHeaders.get('Origin') !== null &&
		reqHeaders.get('Access-Control-Request-Method') !== null &&
		reqHeaders.get('Access-Control-Request-Headers') !== null
	) {
		// Handle CORS preflight requests
		const allowedOrigin = (env && env.FRONTEND_ORIGIN && env.ENVIRONMENT !== 'development')
			? env.FRONTEND_ORIGIN
			: '*';

		let respHeaders = {
			'Access-Control-Allow-Origin': allowedOrigin,
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
			'Access-Control-Allow-Headers': reqHeaders.get('Access-Control-Request-Headers'),
			'Access-Control-Max-Age': '86400',
		};
		return new Response(null, { headers: respHeaders });
	} else {
		// Handle standard OPTIONS request
		return new Response(null, { headers: { Allow: 'GET, POST, PUT, DELETE, PATCH, OPTIONS' } });
	}
}

export function validateInput(data, requiredFields) {
	if (!data || typeof data !== 'object') {
		return 'Request body is missing or not a valid JSON object.';
	}
	for (const field of requiredFields) {
		const value = data[field];
		if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
			return `Missing or empty required field: ${field}`;
		}
	}
	if (data.username !== undefined && (typeof data.username !== 'string' || data.username.trim().length < 3 || data.username.trim().length > 50)) {
		return 'Username must be a string between 3 and 50 characters.';
	}
	if (data.password !== undefined && (typeof data.password !== 'string' || data.password.length < 8)) {
		return 'Password must be a string of at least 8 characters.';
	}
	if (data.masterPassword !== undefined && (typeof data.masterPassword !== 'string' || data.masterPassword.length < 10)) {
		return 'Master Password must be a string of at least 10 characters.';
	}
	if (data.content !== undefined) {
		if (typeof data.content !== 'string') return 'Message content must be a string.';
		if (data.content.length > 1000) return 'Message content cannot exceed 1000 characters.';
	}
	if (data.userId !== undefined && (typeof data.userId !== 'number' || !Number.isInteger(data.userId) || data.userId <= 0)) {
		return 'User ID must be a positive integer.';
	}
	if (data.partnerId !== undefined && (typeof data.partnerId !== 'number' || !Number.isInteger(data.partnerId) || data.partnerId <= 0)) {
		return 'Partner ID must be a positive integer.';
	}
	if (data.reply_to_message_id !== undefined && data.reply_to_message_id !== null && (typeof data.reply_to_message_id !== 'number' || !Number.isInteger(data.reply_to_message_id) || data.reply_to_message_id <= 0)) {
		return 'Reply ID must be a positive integer or null.';
	}
	return null; // Validation passed
}

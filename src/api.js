// src/api.js
import { jsonResponse, sha256, validateInput } from "./utils.js";
import { getAppConfig, getConversationParticipants } from "./db.js";
import {
  generateJwtToken,
  requireAuth,
  requireAdminAuth,
  verifyMasterPassword,
} from "./auth.js";

const ROUTER_DO_ID = "global-aurachat-router";

async function broadcastToRouter(env, recipients, message) {
  if (!recipients || recipients.length === 0) return;
  const durableObjectId = env.ROUTER_DO.idFromName(ROUTER_DO_ID);
  const stub = env.ROUTER_DO.get(durableObjectId);
  await stub.fetch("https://internal-do/broadcast", {
    method: "POST",
    body: JSON.stringify({ recipients, message }),
  });
}

export async function handleApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/", "");
  const pathSegments = path.split("/").filter(Boolean);
  const method = request.method;
  let body = null;

  try {
    // FIX: Parse the body ONLY ONCE, at the top level.
    if (
      request.method === "POST" ||
      request.method === "PATCH" ||
      request.method === "PUT"
    ) {
      if (
        request.headers.get("content-length") !== "0" &&
        request.headers.get("content-type")?.includes("application/json")
      ) {
        body = await request.json();
      }
    }

    // AUTH AND SETUP ROUTES (No changes needed here)
    if (method === "GET" && path === "setup/status") {
      const adminCreated = await getAppConfig(env.DB, "admin_created");
      return jsonResponse(
        { adminExists: adminCreated === "true" },
        200,
        {},
        env
      );
    }
    if (method === "POST" && path === "setup/admin") {
      const adminCreated = await getAppConfig(env.DB, "admin_created");
      if (adminCreated === "true")
        return jsonResponse(
          { error: "Admin account already exists." },
          409,
          {},
          env
        );
      const validationError = validateInput(body, [
        "username",
        "password",
        "masterPassword",
      ]);
      if (validationError)
        return jsonResponse({ error: validationError }, 400, {}, env);
      const passwordHash = await sha256(body.password);
      const masterPasswordHash = await sha256(body.masterPassword);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?1, ?2, 1, ?3)"
        ).bind(body.username.trim(), passwordHash, new Date().toISOString()),
        env.DB.prepare(
          "INSERT OR REPLACE INTO app_config (config_key, config_value) VALUES (?1, ?2)"
        ).bind("master_password_hash", masterPasswordHash),
        env.DB.prepare(
          "INSERT OR REPLACE INTO app_config (config_key, config_value) VALUES (?1, ?2)"
        ).bind("admin_created", "true"),
      ]);
      return jsonResponse({ success: true }, 201, {}, env);
    }
    if (method === "POST" && path === "auth/login") {
      const validationError = validateInput(body, ["username", "password"]);
      if (validationError)
        return jsonResponse({ error: validationError }, 400, {}, env);
      const user = await env.DB.prepare(
        "SELECT id, username, password_hash, is_admin FROM users WHERE username = ?1 COLLATE NOCASE"
      )
        .bind(body.username)
        .first();
      if (!user || user.is_admin)
        return jsonResponse({ error: "Invalid credentials." }, 401, {}, env);
      const passwordHash = await sha256(body.password);
      if (passwordHash !== user.password_hash)
        return jsonResponse({ error: "Invalid credentials." }, 401, {}, env);
      const token = await generateJwtToken(env, user.id, user.username, false);
      return jsonResponse(
        {
          success: true,
          token,
          user: { id: user.id, username: user.username, isAdmin: false },
        },
        200,
        {},
        env
      );
    }
    if (method === "POST" && path === "auth/admin/login") {
      const validationError = validateInput(body, ["masterPassword"]);
      if (validationError)
        return jsonResponse({ error: validationError }, 400, {}, env);
      const isValid = await verifyMasterPassword(env.DB, body.masterPassword);
      if (!isValid)
        return jsonResponse(
          { error: "Invalid master password." },
          401,
          {},
          env
        );
      const adminUser = await env.DB.prepare(
        "SELECT id, username FROM users WHERE is_admin = 1 LIMIT 1"
      ).first();
      if (!adminUser)
        return jsonResponse(
          { error: "Admin account configuration error." },
          500,
          {},
          env
        );
      const token = await generateJwtToken(
        env,
        adminUser.id,
        adminUser.username,
        true
      );
      return jsonResponse(
        {
          success: true,
          token,
          user: {
            id: adminUser.id,
            username: adminUser.username,
            isAdmin: true,
          },
        },
        200,
        {},
        env
      );
    }

    // REAL-TIME APP LOGIC ROUTES
    if (
      method === "POST" &&
      pathSegments[0] === "conversations" &&
      pathSegments[2] === "messages"
    ) {
      return await requireAuth(request, env, ctx, async (req) => {
        const conversationId = parseInt(pathSegments[1], 10);
        const userId = req.auth.userId;
        const username = req.auth.username;
        const content = body.content.trim();
        const replyToMessageId = body.reply_to_message_id
          ? parseInt(body.reply_to_message_id, 10)
          : null;
        const now = new Date().toISOString();
        const result = await env.DB.prepare(
          "INSERT INTO messages (conversation_id, sender_id, content, timestamp, reply_to_message_id) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id"
        )
          .bind(conversationId, userId, content, now, replyToMessageId)
          .first();
        const newMessageId = result.id;
        ctx.waitUntil(
          env.DB.prepare(
            "UPDATE conversations SET last_activity_ts = ?1 WHERE id = ?2"
          )
            .bind(now, conversationId)
            .run()
        );
        const newMessageData = await env.DB.prepare(
          `SELECT m.id, m.content, m.timestamp, m.sender_id, ?4 as sender_username, m.conversation_id, m.is_edited, m.edited_at, m.reply_to_message_id, reply_msg.content as reply_snippet, reply_sender.username as reply_sender_username FROM messages m LEFT JOIN messages reply_msg ON m.reply_to_message_id = reply_msg.id LEFT JOIN users reply_sender ON reply_msg.sender_id = reply_sender.id WHERE m.id = ?1 AND m.conversation_id = ?2 AND m.sender_id = ?3`
        )
          .bind(newMessageId, conversationId, userId, username)
          .first();
        const finalMessageObject = {
          ...newMessageData,
          isReadByPartner: false,
          is_edited: false,
        };

        const participants = await getConversationParticipants(
          env.DB,
          conversationId,
          userId
        );
        ctx.waitUntil(
          broadcastToRouter(env, participants, {
            type: "new_message",
            payload: finalMessageObject,
          })
        );

        return jsonResponse(
          { success: true, message: finalMessageObject },
          201,
          {},
          env
        );
      });
    }

    if (method === "PATCH" && pathSegments[0] === "messages") {
      return await requireAuth(request, env, ctx, async (req) => {
        const messageId = parseInt(pathSegments[1], 10);
        const userId = req.auth.userId;
        const newContent = body.content.trim();
        const originalMessage = await env.DB.prepare(
          "SELECT sender_id, conversation_id FROM messages WHERE id = ?1"
        )
          .bind(messageId)
          .first();
        if (originalMessage?.sender_id !== userId)
          return jsonResponse({ error: "Forbidden" }, 403, {}, env);
        const now = new Date().toISOString();
        await env.DB.prepare(
          "UPDATE messages SET content = ?1, is_edited = 1, edited_at = ?2 WHERE id = ?3"
        )
          .bind(newContent, now, messageId)
          .run();

        const participants = await getConversationParticipants(
          env.DB,
          originalMessage.conversation_id
        );
        ctx.waitUntil(
          broadcastToRouter(env, participants, {
            type: "message_updated",
            payload: {
              messageId,
              conversationId: originalMessage.conversation_id,
              newContent,
              editedAt: now,
            },
          })
        );

        return jsonResponse({ success: true, edited_at: now }, 200, {}, env);
      });
    }

    if (method === "DELETE" && pathSegments[0] === "messages") {
      return await requireAuth(request, env, ctx, async (req) => {
        const messageId = parseInt(pathSegments[1], 10);
        const userId = req.auth.userId;
        const message = await env.DB.prepare(
          "SELECT conversation_id, sender_id FROM messages WHERE id = ?1"
        )
          .bind(messageId)
          .first();
        if (!message || message.sender_id !== userId)
          return jsonResponse(
            { error: "Forbidden or Not Found" },
            403,
            {},
            env
          );
        const { meta } = await env.DB.prepare(
          "DELETE FROM messages WHERE id = ?1 AND sender_id = ?2"
        )
          .bind(messageId, userId)
          .run();
        if (meta.changes > 0) {
          const participants = await getConversationParticipants(
            env.DB,
            message.conversation_id
          );
          ctx.waitUntil(
            broadcastToRouter(env, participants, {
              type: "message_deleted",
              payload: { messageId, conversationId: message.conversation_id },
            })
          );
        }
        return new Response(null, { status: meta.changes > 0 ? 204 : 403 });
      });
    }

    if (path.startsWith("admin/")) {
      if (method === "POST" && path === "admin/users") {
        return await requireAdminAuth(request, env, ctx, async (req) => {
          const username = body.username.trim();
          const userExists = await env.DB.prepare(
            "SELECT id FROM users WHERE username = ?1 COLLATE NOCASE"
          )
            .bind(username)
            .first();
          if (userExists)
            return jsonResponse(
              { error: "Username already exists." },
              409,
              {},
              env
            );
          const passwordHash = await sha256(body.password);
          const now = new Date().toISOString();
          const newUser = await env.DB.prepare(
            "INSERT INTO users (username, password_hash, is_admin, created_at, last_active_ts) VALUES (?1, ?2, 0, ?3, ?3) RETURNING id, username, created_at, last_active_ts"
          )
            .bind(username, passwordHash, now)
            .first();

          const { results } = await env.DB.prepare(
            "SELECT id FROM users WHERE is_admin = 1"
          ).all();
          const adminIds = results.map((r) => r.id);
          ctx.waitUntil(
            broadcastToRouter(env, adminIds, {
              type: "user_created",
              payload: newUser,
            })
          );

          return jsonResponse(
            { success: true, userId: newUser.id },
            201,
            {},
            env
          );
        });
      }
      if (
        method === "DELETE" &&
        pathSegments[0] === "admin" &&
        pathSegments[1] === "users"
      ) {
        return await requireAdminAuth(request, env, ctx, async (req) => {
          const userIdToDelete = parseInt(pathSegments[2], 10);
          if (userIdToDelete === req.auth.userId)
            return jsonResponse(
              { error: "Cannot delete yourself." },
              403,
              {},
              env
            );

          const { results } = await env.DB.prepare(
            "SELECT id FROM users WHERE is_admin = 1"
          ).all();
          const adminIds = results.map((r) => r.id);
          ctx.waitUntil(
            broadcastToRouter(env, adminIds, {
              type: "user_deleted",
              payload: { userId: userIdToDelete },
            })
          );

          await env.DB.prepare(
            "DELETE FROM users WHERE id = ?1 AND is_admin = 0"
          )
            .bind(userIdToDelete)
            .run();
          return new Response(null, { status: 204 });
        });
      }
    }

    // FIX: Pass the already-parsed body to the fallback handler.
    return handleApiRequest_NoBroadcast(request, env, ctx, body);
  } catch (error) {
    console.error(`API Handler Error (${method} /api/${path}):`, error);
    const status = error.status || 500;
    const message =
      status < 500 && error.message ? error.message : "Internal Server Error.";
    return jsonResponse({ error: message }, status, {}, env);
  }
}

// FIX: This function now accepts the pre-parsed body as an argument.
async function handleApiRequest_NoBroadcast(request, env, ctx, body) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/", "");
  const pathSegments = path.split("/").filter(Boolean);
  const method = request.method;

  // FIX: Body parsing is removed from here as it's done in the main function.

  if (method === "GET" && path === "users") {
    return await requireAuth(request, env, ctx, async (req) => {
      const userId = req.auth.userId;
      const query = `SELECT u.id, u.username, u.last_active_ts FROM users u WHERE u.id != ?1 AND u.is_admin = 0 AND NOT EXISTS ( SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ?2) OR (b.blocker_id = ?3 AND b.blocked_id = u.id)) ORDER BY u.username COLLATE NOCASE ASC;`;
      const { results } = await env.DB.prepare(query)
        .bind(userId, userId, userId)
        .all();
      return jsonResponse(results || [], 200, {}, env);
    });
  }
  if (method === "GET" && path === "conversations") {
    return await requireAuth(request, env, ctx, async (req) => {
      const userId = req.auth.userId;
      const query = ` WITH LatestMessage AS ( SELECT m.conversation_id, m.content, m.timestamp, m.sender_id, u_sender.username as sender_username, ROW_NUMBER() OVER(PARTITION BY m.conversation_id ORDER BY m.timestamp DESC) as rn FROM messages m JOIN users u_sender ON m.sender_id = u_sender.id ), PartnerInfo AS ( SELECT cp.conversation_id, p.id as partner_id, p.username as partner_username, p.last_active_ts as partner_last_active_ts FROM conversation_participants cp JOIN users p ON cp.user_id = p.id WHERE cp.conversation_id IN (SELECT cp_inner.conversation_id FROM conversation_participants cp_inner WHERE cp_inner.user_id = ?1) AND cp.user_id != ?2 ) SELECT c.id, c.last_activity_ts, lm.content as last_message_content, lm.timestamp as last_message_ts, lm.sender_username as last_message_sender, (SELECT COUNT(*) FROM messages m_unread WHERE m_unread.conversation_id = c.id AND m_unread.sender_id != ?3 AND NOT EXISTS (SELECT 1 FROM message_read_status mrs WHERE mrs.message_id = m_unread.id AND mrs.user_id = ?4)) as unread_count, pi.partner_id, pi.partner_username, pi.partner_last_active_ts FROM conversations c JOIN conversation_participants self_cp ON c.id = self_cp.conversation_id AND self_cp.user_id = ?5 JOIN PartnerInfo pi ON c.id = pi.conversation_id LEFT JOIN LatestMessage lm ON c.id = lm.conversation_id AND lm.rn = 1 WHERE NOT EXISTS ( SELECT 1 FROM blocks b WHERE (b.blocker_id = pi.partner_id AND b.blocked_id = self_cp.user_id) ) ORDER BY c.last_activity_ts DESC; `;
      const { results } = await env.DB.prepare(query)
        .bind(userId, userId, userId, userId, userId)
        .all();
      return jsonResponse(results || [], 200, {}, env);
    });
  }
  if (method === "POST" && path === "conversations") {
    return await requireAuth(request, env, ctx, async (req) => {
      const userId = req.auth.userId;
      const partnerId = body.partnerId;
      if (partnerId === userId)
        return jsonResponse(
          { error: "Cannot start a conversation with yourself." },
          400,
          {},
          env
        );
      const existingConv = await env.DB.prepare(
        `SELECT p1.conversation_id FROM conversation_participants p1 INNER JOIN conversation_participants p2 ON p1.conversation_id = p2.conversation_id WHERE p1.user_id = ?1 AND p2.user_id = ?2 LIMIT 1`
      )
        .bind(userId, partnerId)
        .first("conversation_id");
      if (existingConv)
        return jsonResponse(
          { success: true, conversationId: existingConv, existed: true },
          200,
          {},
          env
        );
      const now = new Date().toISOString();
      const result = await env.DB.prepare(
        "INSERT INTO conversations (creator_id, last_activity_ts) VALUES (?1, ?2) RETURNING id"
      )
        .bind(userId, now)
        .first();
      const newConversationId = result.id;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?1, ?2)"
        ).bind(newConversationId, userId),
        env.DB.prepare(
          "INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?1, ?2)"
        ).bind(newConversationId, partnerId),
      ]);
      return jsonResponse(
        { success: true, conversationId: newConversationId, existed: false },
        201,
        {},
        env
      );
    });
  }
  if (
    method === "GET" &&
    pathSegments[0] === "conversations" &&
    pathSegments[2] === "messages"
  ) {
    return await requireAuth(request, env, ctx, async (req) => {
      const conversationId = parseInt(pathSegments[1], 10);
      const sinceTimestamp = url.searchParams.get("since");
      const beforeTimestamp = url.searchParams.get("before_ts");
      const initialLoadLimit = 50,
        loadOlderLimit = 30,
        userId = req.auth.userId;
      const baseSelect = ` SELECT m.id, m.content, m.timestamp, m.sender_id, u.username as sender_username, m.conversation_id, m.is_edited, m.edited_at, m.reply_to_message_id, reply_msg.content as reply_snippet, reply_sender.username as reply_sender_username FROM messages m JOIN users u ON m.sender_id = u.id LEFT JOIN messages reply_msg ON m.reply_to_message_id = reply_msg.id LEFT JOIN users reply_sender ON reply_msg.sender_id = reply_sender.id `;
      let query;
      const params = [conversationId];
      if (sinceTimestamp) {
        query = `${baseSelect} WHERE m.conversation_id = ?1 AND m.timestamp > ?2 ORDER BY m.timestamp ASC;`;
        params.push(sinceTimestamp);
      } else if (beforeTimestamp) {
        query = `${baseSelect} WHERE m.conversation_id = ?1 AND m.timestamp < ?2 ORDER BY m.timestamp DESC LIMIT ?3;`;
        params.push(beforeTimestamp, loadOlderLimit);
      } else {
        query = `${baseSelect} WHERE m.conversation_id = ?1 ORDER BY m.timestamp DESC LIMIT ?2;`;
        params.push(initialLoadLimit);
      }
      const { results } = await env.DB.prepare(query)
        .bind(...params)
        .all();
      let messagesData = (results || []).map((msg) => ({
        ...msg,
        is_edited: !!msg.is_edited,
      }));
      if (!sinceTimestamp) messagesData.reverse();
      return jsonResponse(messagesData, 200, {}, env);
    });
  }
  if (method === "GET" && path === "blocks") {
    return await requireAuth(request, env, ctx, async (req) => {
      const userId = req.auth.userId;
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.username FROM blocks b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = ?1 ORDER BY u.username COLLATE NOCASE ASC`
      )
        .bind(userId)
        .all();
      return jsonResponse(results || [], 200, {}, env);
    });
  }
  if (method === "POST" && path === "blocks") {
    return await requireAuth(request, env, ctx, async (req) => {
      const userId = req.auth.userId;
      const blockedId = body.userId;
      await env.DB.prepare(
        "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?1, ?2)"
      )
        .bind(userId, blockedId)
        .run();
      return jsonResponse({ success: true }, 201, {}, env);
    });
  }
  if (method === "DELETE" && pathSegments[0] === "blocks") {
    return await requireAuth(request, env, ctx, async (req) => {
      const blockerId = req.auth.userId;
      const blockedIdToUnblock = parseInt(pathSegments[1], 10);
      await env.DB.prepare(
        "DELETE FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2"
      )
        .bind(blockerId, blockedIdToUnblock)
        .run();
      return jsonResponse({ success: true }, 200, {}, env);
    });
  }
  if (method === "GET" && path === "admin/stats") {
    return await requireAdminAuth(request, env, ctx, async (req) => {
      const [userCountRes, messageCountRes, convCountRes, activeUsersRes] =
        await Promise.all([
          env.DB.prepare(
            "SELECT COUNT(*) as count FROM users WHERE is_admin = 0"
          ).first("count"),
          env.DB.prepare("SELECT COUNT(*) as count FROM messages").first(
            "count"
          ),
          env.DB.prepare("SELECT COUNT(*) as count FROM conversations").first(
            "count"
          ),
          env.DB.prepare(
            "SELECT COUNT(*) as count FROM users WHERE is_admin = 0 AND last_active_ts > ?1"
          )
            .bind(new Date(Date.now() - 5 * 60 * 1000).toISOString())
            .first("count"),
        ]);
      return jsonResponse(
        {
          userCount: userCountRes ?? 0,
          messageCount: messageCountRes ?? 0,
          conversationCount: convCountRes ?? 0,
          activeUsers: activeUsersRes ?? 0,
        },
        200,
        {},
        env
      );
    });
  }
  if (method === "GET" && path === "admin/users") {
    return await requireAdminAuth(request, env, ctx, async (req) => {
      const { results } = await env.DB.prepare(
        "SELECT id, username, created_at, last_active_ts FROM users WHERE is_admin = 0 ORDER BY username COLLATE NOCASE ASC"
      ).all();
      return jsonResponse(results || [], 200, {}, env);
    });
  }
  return jsonResponse({ error: "API Endpoint Not Found" }, 404, {}, env);
}

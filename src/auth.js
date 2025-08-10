import { sha256 } from "./utils.js";
import { getAppConfig } from "./db.js";
import * as jose from "jose";

const JWT_ALGORITHM = "HS256";
const JWT_EXPIRATION_TIME = "2h";
let encodedSecret = null;

async function getJwtSecret(env) {
  if (encodedSecret) return encodedSecret;
  const secretString = env.JWT_SECRET;
  if (!secretString || secretString.length < 32) {
    console.error("FATAL: JWT_SECRET missing or too short.");
    throw new Error("JWT secret configuration error.");
  }
  encodedSecret = new TextEncoder().encode(secretString);
  return encodedSecret;
}

export async function generateJwtToken(env, userId, username, isAdmin) {
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    console.error("Invalid userId for JWT generation:", userId);
    throw new Error("Invalid user identifier.");
  }
  if (!username) {
    console.error("Username missing for JWT generation for userId:", userId);
    throw new Error("Username required.");
  }
  try {
    const secret = await getJwtSecret(env);
    return await new jose.SignJWT({ isAdmin, username })
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setSubject(userId.toString())
      .setIssuedAt()
      .setExpirationTime(JWT_EXPIRATION_TIME)
      .sign(secret);
  } catch (error) {
    console.error("Error generating JWT:", error);
    throw new Error("Failed to generate session token.");
  }
}

// NEW EXPORT for WS verification
export async function verifyJwtToken(token, env) {
  if (!token) return null;
  try {
    const secret = await getJwtSecret(env);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALGORITHM],
    });
    if (
      !payload.sub ||
      typeof payload.isAdmin !== "boolean" ||
      typeof payload.username !== "string"
    ) {
      console.warn("JWT verification failed: Payload missing required fields.");
      return null;
    }
    const userId = parseInt(payload.sub, 10);
    if (isNaN(userId) || userId <= 0) {
      console.warn(
        "JWT verification failed: Invalid user ID (sub) in payload:",
        payload.sub
      );
      return null;
    }
    return { userId, username: payload.username, isAdmin: payload.isAdmin };
  } catch (error) {
    const subject = error.payload?.sub ?? "unknown user";
    if (error instanceof jose.errors.JWTExpired) {
      console.info(
        `JWT verification failed for user ${subject}: Token expired.`
      );
    } else if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      console.warn(
        `JWT verification failed for user ${subject}: Invalid signature.`
      );
    } else if (
      error instanceof jose.errors.JWSInvalid ||
      error instanceof jose.errors.JWTInvalid
    ) {
      console.warn(
        `JWT verification failed for user ${subject}: Invalid token format/claims.`
      );
    } else if (error instanceof jose.errors.JWTClaimValidationFailed) {
      console.warn(
        `JWT verification failed: Claim validation failed (${error.claim} = ${error.reason}).`
      );
    } else {
      console.error(
        `Unexpected JWT verification error for user ${subject}:`,
        error
      );
    }
    return null;
  }
}

async function verifyJwtFromRequest(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  return verifyJwtToken(token, env); // Use the exported function
}

async function updateUserLastActive(env, userId) {
  if (!userId || !env?.DB) {
    console.warn(
      `updateUserLastActive skipped: Missing userId (${userId}) or DB.`
    );
    return;
  }
  try {
    await env.DB.prepare("UPDATE users SET last_active_ts = ?1 WHERE id = ?2")
      .bind(new Date().toISOString(), userId)
      .run();
  } catch (e) {
    console.error(
      `Background task failed: Could not update last_active_ts for user ${userId}:`,
      e
    );
  }
}

async function verifyUserExists(env, userId, isAdminExpected) {
  if (!env?.DB) {
    throw new Error("Database unavailable for user verification.");
  }
  try {
    const userCheck = await env.DB.prepare(
      "SELECT is_admin FROM users WHERE id = ?1"
    )
      .bind(userId)
      .first("is_admin");

    if (userCheck === null) {
      console.warn(
        `Auth rejection: User ${userId} from token not found in DB.`
      );
      return false;
    }
    // Ensure boolean comparison for isAdminExpected (0/1 vs false/true)
    if (!!userCheck !== !!isAdminExpected) {
      console.warn(
        `Auth rejection: User ${userId} admin status mismatch (Expected: ${isAdminExpected}, Found: ${userCheck}).`
      );
      return false;
    }
    return true;
  } catch (dbError) {
    console.error(
      `Database error during user verification for user ${userId}:`,
      dbError
    );
    throw new Error("Server error during authorization check.");
  }
}

export async function requireAuth(request, env, ctx, handler) {
  const authPayload = await verifyJwtFromRequest(request, env);
  if (!authPayload) {
    const error = new Error("Unauthorized: Invalid or missing token.");
    error.status = 401;
    throw error;
  }
  if (authPayload.isAdmin) {
    console.warn(
      `Auth rejection: Admin user ${authPayload.userId} accessing user route.`
    );
    const error = new Error("Forbidden: Endpoint requires non-admin user.");
    error.status = 403;
    throw error;
  }
  if (!(await verifyUserExists(env, authPayload.userId, false))) {
    const error = new Error("Unauthorized: User account invalid or not found.");
    error.status = 401;
    throw error;
  }
  ctx.waitUntil(updateUserLastActive(env, authPayload.userId));
  request.auth = authPayload;
  return handler(request, env, ctx);
}

export async function requireAdminAuth(request, env, ctx, handler) {
  const authPayload = await verifyJwtFromRequest(request, env);
  if (!authPayload) {
    const error = new Error("Unauthorized: Invalid or missing token.");
    error.status = 401;
    throw error;
  }
  if (!authPayload.isAdmin) {
    console.warn(
      `Auth rejection: Non-admin user ${authPayload.userId} accessing admin route.`
    );
    const error = new Error("Forbidden: Admin access required.");
    error.status = 403;
    throw error;
  }
  if (!(await verifyUserExists(env, authPayload.userId, true))) {
    const error = new Error(
      "Unauthorized: Admin account invalid or not found."
    );
    error.status = 401;
    throw error;
  }
  ctx.waitUntil(updateUserLastActive(env, authPayload.userId));
  request.auth = authPayload;
  return handler(request, env, ctx);
}

export async function verifyMasterPassword(db, providedPassword) {
  if (!providedPassword) return false;
  const storedHash = await getAppConfig(db, "master_password_hash");
  if (!storedHash || storedHash === "") {
    console.error("CRITICAL: Master password hash missing/empty.");
    return false;
  }
  try {
    const providedHash = await sha256(providedPassword);
    return providedHash === storedHash;
  } catch (hashError) {
    console.error(
      "Error hashing master password during verification:",
      hashError
    );
    return false;
  }
}

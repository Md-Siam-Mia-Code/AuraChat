import { verifyJwtToken } from "./auth.js";

export function jsonResponse(data, status = 200, headers = {}, env) {
  const defaultHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...defaultHeaders, ...headers },
  });
}

export function handleOptions(request, env) {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function sha256(string) {
  const utf8 = new TextEncoder().encode(string);
  const hashBuffer = await crypto.subtle.digest("SHA-256", utf8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((bytes) => bytes.toString(16).padStart(2, "0")).join("");
}

export function validateInput(body, requiredFields) {
  if (!body) return "Request body is missing or not JSON.";
  for (const field of requiredFields) {
    if (!body[field]) {
      return `Missing required field: ${field}.`;
    }
  }
  return null;
}

export async function getUserIdFromRequest(request, env) {
  const url = new URL(request.url);
  let token = url.searchParams.get("token");

  if (!token) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
  }

  if (!token) return null;

  try {
    const payload = await verifyJwtToken(token, env);
    return payload ? payload.userId : null;
  } catch {
    return null;
  }
}

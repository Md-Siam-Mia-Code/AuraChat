// src/utils.js

export async function sha256(str) {
  try {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    console.error("FATAL: sha256 hashing failed:", error);
    throw new Error("Hashing failed internally.");
  }
}

export function jsonResponse(body, status = 200, headers = {}, env = null) {
  const allowedOrigin = env?.FRONTEND_ORIGIN || "*";

  const finalHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
    ...headers,
  };
  return new Response(JSON.stringify(body), { status, headers: finalHeaders });
}

export function handleOptions(request, env = null) {
  const allowedOrigin = env?.FRONTEND_ORIGIN || "*";
  let headers = request.headers;
  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null &&
    headers.get("Access-Control-Request-Headers") !== null
  ) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods":
          "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": headers.get(
          "Access-Control-Request-Headers"
        ),
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  return new Response(null, {
    headers: { Allow: "GET, POST, PUT, DELETE, PATCH, OPTIONS" },
  });
}

export function validateInput(data, requiredFields) {
  if (!data || typeof data !== "object") {
    return "Request body is missing or not a valid JSON object.";
  }
  for (const field of requiredFields) {
    const value = data[field];
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return `Missing or empty required field: ${field}`;
    }
  }
  return null; // Validation passed
}

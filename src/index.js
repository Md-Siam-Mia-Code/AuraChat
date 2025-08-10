// src/index.js

import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
import manifestJSON from "__STATIC_CONTENT_MANIFEST";
import { handleApiRequest } from "./api.js";
import { handleWebSocketUpgrade } from "./websocket.js";
import { handleOptions } from "./utils.js";

const assetManifest = JSON.parse(manifestJSON);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return handleOptions(request, env);
      }
      if (url.pathname === "/ws") {
        const upgradeHeader = request.headers.get("Upgrade");
        if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
          return handleWebSocketUpgrade(request, env, ctx);
        }
      }
      if (url.pathname.startsWith("/api/")) {
        return handleApiRequest(request, env, ctx);
      }

      // Define options for the asset handler
      const options = {
        ASSET_NAMESPACE: env.__STATIC_CONTENT,
        ASSET_MANIFEST: assetManifest,
      };

      // Try to serve the static asset
      return await getAssetFromKV(
        {
          request,
          waitUntil(promise) {
            return ctx.waitUntil(promise);
          },
        },
        options
      );
    } catch (e) {
      // Handle 404s for SPA routing
      if (e.status === 404) {
        try {
          // Redefine options for the fallback request
          const fallbackOptions = {
            ASSET_NAMESPACE: env.__STATIC_CONTENT,
            ASSET_MANIFEST: assetManifest,
          };

          let notFoundResponse = await getAssetFromKV(
            {
              request,
              waitUntil(promise) {
                return ctx.waitUntil(promise);
              },
            },
            {
              ...fallbackOptions,
              mapRequestToAsset: () =>
                new Request(`${url.origin}/index.html`, request),
            }
          );

          return new Response(notFoundResponse.body, {
            ...notFoundResponse,
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        } catch (e) {
          console.error("CRITICAL: index.html not found in assets.", e);
          return new Response("Not found", { status: 404 });
        }
      }
      // For all other errors
      console.error("Worker fetch error:", e);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

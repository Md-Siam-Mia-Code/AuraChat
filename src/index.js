// src/index.js
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
import manifestJSON from "__STATIC_CONTENT_MANIFEST";
import { handleApiRequest } from "./api.js";
import { handleOptions } from "./utils.js";
import { verifyJwtToken } from "./auth.js";

export { RouterDO } from "./router.js";

const assetManifest = JSON.parse(manifestJSON);
const ROUTER_DO_ID = "global-aurachat-router";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return handleOptions(request, env);
      }

      if (url.pathname.startsWith("/ws")) {
        const token = url.searchParams.get("token");
        const authPayload = await verifyJwtToken(token, env);
        if (!authPayload) {
          return new Response("Missing or invalid token", { status: 401 });
        }

        const durableObjectId = env.ROUTER_DO.idFromName(ROUTER_DO_ID);
        const durableObjectStub = env.ROUTER_DO.get(durableObjectId);

        const newUrl = new URL(request.url);
        newUrl.pathname = "/websocket";
        newUrl.searchParams.set("userId", authPayload.userId);

        return durableObjectStub.fetch(new Request(newUrl, request));
      }

      if (url.pathname.startsWith("/api/")) {
        return handleApiRequest(request, env, ctx);
      }

      return await getAssetFromKV(
        {
          request,
          waitUntil: (promise) => ctx.waitUntil(promise),
        },
        {
          ASSET_NAMESPACE: env.__STATIC_CONTENT,
          ASSET_MANIFEST: assetManifest,
          mapRequestToAsset: (req) => {
            const url = new URL(req.url);
            if (url.pathname.match(/\.(css|js|ico|png|svg|jpg|jpeg|gif)$/)) {
              return req;
            }
            return new Request(`${url.origin}/index.html`, req);
          },
        }
      );
    } catch (e) {
      console.error("Worker fetch error:", e);
      if (e.status === 404) {
        return new Response("Not found", { status: 404 });
      }
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

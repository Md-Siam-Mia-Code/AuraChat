import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
import manifestJSON from "__STATIC_CONTENT_MANIFEST";
import { handleApiRequest } from "./api.js";
import { handleOptions, getUserIdFromRequest } from "./utils.js";

export { UserSession } from "./user-session.js";

const assetManifest = JSON.parse(manifestJSON);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return handleOptions(request, env);
      }

      if (url.pathname.startsWith("/ws")) {
        const userId = await getUserIdFromRequest(request, env);
        if (!userId) {
          return new Response("Missing or invalid token", { status: 401 });
        }
        const durableObjectId = env.USER_SESSIONS.idFromName(userId.toString());
        const durableObjectStub = env.USER_SESSIONS.get(durableObjectId);

        const newUrl = new URL(request.url);
        newUrl.pathname = "/websocket";
        newUrl.searchParams.set("userId", userId);

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

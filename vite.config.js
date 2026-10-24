import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import initiateSubscription from "./api/subscription/initiate.js";
import verifySubscription from "./api/subscription/verify.js";

function localSubscriptionApi() {
  const routes = new Map([
    ["/api/subscription/initiate", initiateSubscription],
    ["/api/subscription/verify", verifySubscription]
  ]);

  return {
    name: "local-subscription-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handler = routes.get(new URL(req.url, "http://localhost").pathname);
        if (!handler) return next();
        if (req.method !== "POST") return next();

        let rawBody = "";
        try {
          for await (const chunk of req) {
            rawBody += chunk;
            if (rawBody.length > 16_384) {
              res.statusCode = 413;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Request body is too large." }));
              return;
            }
          }
          req.body = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Request body must be valid JSON." }));
          return;
        }

        const response = {
          status(statusCode) {
            res.statusCode = statusCode;
            return this;
          },
          setHeader(name, value) {
            res.setHeader(name, value);
            return this;
          },
          json(body) {
            res.end(JSON.stringify(body));
            return this;
          }
        };
        await handler(req, response);
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const localEnvironment = loadEnv(mode, process.cwd(), "");
  if (localEnvironment.PAYSTACK_SECRET_KEY) {
    process.env.PAYSTACK_SECRET_KEY = localEnvironment.PAYSTACK_SECRET_KEY;
  }
  process.env.APP_URL = localEnvironment.APP_URL || process.env.APP_URL || "http://localhost:5173";

  return {
    plugins: [
      react(),
      localSubscriptionApi(),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.js",
        injectRegister: false,
        manifest: false,
        injectManifest: {
          globPatterns: ["**/*.{css,html,ico,js,json,png,svg,webmanifest,woff,woff2}"]
        }
      })
    ],
    build: {
      target: "es2020"
    }
  };
});

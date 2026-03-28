import { Router, type IRouter, type Request, type Response } from "express";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const router: IRouter = Router();

router.get("/models", async (req: Request, res: Response) => {
  const proxyEnabled = process.env.PROXY_ENABLED === "true";
  const baseUrl = process.env.PROXY_BASE_URL ?? "";
  const apiKey = process.env.PROXY_API_KEY ?? "";
  const provider = process.env.PROXY_PROVIDER ?? "openai";

  if (!proxyEnabled || !baseUrl) {
    res.json({
      models: [],
      message: "Proxy not configured. Set PROXY_ENABLED=true and PROXY_BASE_URL to list models.",
    });
    return;
  }

  try {
    const modelsPath = provider === "anthropic" ? "/v1/models" : "/v1/models";
    const targetUrl = new URL(`${baseUrl.replace(/\/$/, "")}${modelsPath}`);

    const headers: Record<string, string> = {
      accept: "application/json",
    };

    if (apiKey) {
      if (provider === "anthropic") {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
      } else {
        headers["authorization"] = `Bearer ${apiKey}`;
      }
    }

    const protocol = targetUrl.protocol === "https:" ? https : http;

    const models = await new Promise<unknown>((resolve, reject) => {
      const proxyReq = protocol.request(targetUrl, { method: "GET", headers }, (proxyRes) => {
        let data = "";
        proxyRes.on("data", (chunk: Buffer) => (data += chunk.toString()));
        proxyRes.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      });

      proxyReq.on("error", reject);
      proxyReq.setTimeout(10000, () => {
        proxyReq.destroy();
        reject(new Error("Request timed out"));
      });
      proxyReq.end();
    });

    res.json(models);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch models");
    res.status(502).json({
      error: "Failed to fetch models from upstream",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;

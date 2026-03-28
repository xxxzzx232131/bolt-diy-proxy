import { Router, type IRouter, type Request, type Response } from "express";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const router: IRouter = Router();

function getProxyConfig() {
  return {
    baseUrl: process.env.PROXY_BASE_URL ?? "",
    apiKey: process.env.PROXY_API_KEY ?? "",
    enabled: process.env.PROXY_ENABLED === "true",
    timeout: parseInt(process.env.PROXY_TIMEOUT ?? "30000", 10),
    provider: process.env.PROXY_PROVIDER ?? "openai",
  };
}

function buildForwardHeaders(
  req: Request,
  proxyApiKey: string,
  provider: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: req.headers["accept"] as string ?? "application/json",
  };

  if (proxyApiKey) {
    if (provider === "anthropic") {
      headers["x-api-key"] = proxyApiKey;
      headers["anthropic-version"] = (req.headers["anthropic-version"] as string) ?? "2023-06-01";
    } else {
      headers["authorization"] = `Bearer ${proxyApiKey}`;
    }
  } else if (req.headers["authorization"]) {
    headers["authorization"] = req.headers["authorization"] as string;
  } else if (req.headers["x-api-key"]) {
    headers["x-api-key"] = req.headers["x-api-key"] as string;
  }

  if (req.headers["anthropic-version"]) {
    headers["anthropic-version"] = req.headers["anthropic-version"] as string;
  }

  return headers;
}

router.all("/proxy/{*path}", async (req: Request, res: Response) => {
  const config = getProxyConfig();

  if (!config.enabled) {
    res.status(503).json({
      error: "Proxy is disabled. Set PROXY_ENABLED=true and PROXY_BASE_URL to enable.",
    });
    return;
  }

  if (!config.baseUrl) {
    res.status(500).json({
      error: "PROXY_BASE_URL is not configured.",
    });
    return;
  }

  const subPath = (req.params as Record<string, string>).path ?? "";
  const targetUrl = new URL(`${config.baseUrl.replace(/\/$/, "")}/${subPath}`);

  if (req.query && Object.keys(req.query).length > 0) {
    for (const [key, value] of Object.entries(req.query)) {
      targetUrl.searchParams.set(key, String(value));
    }
  }

  const headers = buildForwardHeaders(req, config.apiKey, config.provider);
  const body = JSON.stringify(req.body);
  const isStream = req.body?.stream === true;

  req.log.info({ targetUrl: targetUrl.toString(), provider: config.provider }, "Proxying request");

  try {
    const protocol = targetUrl.protocol === "https:" ? https : http;

    const proxyReq = protocol.request(
      targetUrl,
      {
        method: req.method,
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(body).toString(),
        },
        timeout: config.timeout,
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode ?? 200);
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value !== undefined) {
            res.setHeader(key, value);
          }
        }

        if (isStream) {
          proxyRes.pipe(res);
        } else {
          let data = "";
          proxyRes.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          proxyRes.on("end", () => {
            try {
              res.json(JSON.parse(data));
            } catch {
              res.send(data);
            }
          });
        }
      },
    );

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: "Proxy request timed out" });
      }
    });

    proxyReq.on("error", (err: Error) => {
      req.log.error({ err }, "Proxy request error");
      if (!res.headersSent) {
        res.status(502).json({ error: "Proxy request failed", message: err.message });
      }
    });

    if (req.method !== "GET" && req.method !== "HEAD") {
      proxyReq.write(body);
    }
    proxyReq.end();
  } catch (err) {
    req.log.error({ err }, "Proxy error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal proxy error" });
    }
  }
});

export default router;

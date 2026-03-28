import { Hono } from "hono";
import { cors } from "hono/cors";

export interface Env {
  PROXY_ENABLED: string;
  PROXY_BASE_URL: string;
  PROXY_API_KEY: string;
  PROXY_PROVIDER: string;
  PROXY_TIMEOUT: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// ─── Health ────────────────────────────────────────────────────────────────

app.get("/api/healthz", (c) => {
  return c.json({ status: "ok" });
});

// ─── Config (safe — never exposes secrets) ────────────────────────────────

app.get("/api/config", (c) => {
  return c.json({
    proxy: {
      enabled: c.env.PROXY_ENABLED === "true",
      baseUrl: c.env.PROXY_BASE_URL ? "[configured]" : "[not set]",
      provider: c.env.PROXY_PROVIDER ?? "openai",
      timeout: parseInt(c.env.PROXY_TIMEOUT ?? "30000", 10),
      apiKeySet: Boolean(c.env.PROXY_API_KEY),
    },
  });
});

app.post("/api/config/validate", async (c) => {
  const body = await c.req.json<{ baseUrl?: string; provider?: string }>();
  const errors: string[] = [];

  if (!body.baseUrl) {
    errors.push("baseUrl is required");
  } else {
    try {
      new URL(body.baseUrl);
    } catch {
      errors.push("baseUrl must be a valid URL");
    }
  }

  const validProviders = ["openai", "anthropic", "ollama", "lmstudio", "custom"];
  if (body.provider && !validProviders.includes(body.provider)) {
    errors.push(`provider must be one of: ${validProviders.join(", ")}`);
  }

  if (errors.length > 0) {
    return c.json({ valid: false, errors }, 400);
  }

  return c.json({ valid: true, message: "Configuration looks valid" });
});

// ─── Models ──────────────────────────────────────────────────────────────

app.get("/api/models", async (c) => {
  const proxyEnabled = c.env.PROXY_ENABLED === "true";
  const baseUrl = c.env.PROXY_BASE_URL ?? "";
  const apiKey = c.env.PROXY_API_KEY ?? "";
  const provider = c.env.PROXY_PROVIDER ?? "openai";

  if (!proxyEnabled || !baseUrl) {
    return c.json({
      models: [],
      message: "Proxy not configured. Set PROXY_ENABLED=true and PROXY_BASE_URL to list models.",
    });
  }

  const modelsUrl = `${baseUrl.replace(/\/$/, "")}/v1/models`;
  const headers: Record<string, string> = { accept: "application/json" };

  if (apiKey) {
    if (provider === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["authorization"] = `Bearer ${apiKey}`;
    }
  }

  try {
    const res = await fetch(modelsUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.json();
    return c.json(data, res.status as 200);
  } catch (err) {
    return c.json(
      {
        error: "Failed to fetch models",
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
});

// ─── Proxy ────────────────────────────────────────────────────────────────

app.all("/api/proxy/*", async (c) => {
  const proxyEnabled = c.env.PROXY_ENABLED === "true";
  const baseUrl = c.env.PROXY_BASE_URL ?? "";
  const apiKey = c.env.PROXY_API_KEY ?? "";
  const provider = c.env.PROXY_PROVIDER ?? "openai";
  const timeout = parseInt(c.env.PROXY_TIMEOUT ?? "30000", 10);

  if (!proxyEnabled) {
    return c.json(
      { error: "Proxy is disabled. Set PROXY_ENABLED=true and PROXY_BASE_URL to enable." },
      503,
    );
  }

  if (!baseUrl) {
    return c.json({ error: "PROXY_BASE_URL is not configured." }, 500);
  }

  const url = new URL(c.req.url);
  const subPath = url.pathname.replace(/^\/api\/proxy\/?/, "");
  const targetUrl = new URL(`${baseUrl.replace(/\/$/, "")}/${subPath}`);

  url.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const incomingHeaders = Object.fromEntries(c.req.raw.headers.entries());

  const forwardHeaders: Record<string, string> = {
    "content-type": incomingHeaders["content-type"] ?? "application/json",
    accept: incomingHeaders["accept"] ?? "application/json",
  };

  if (apiKey) {
    if (provider === "anthropic") {
      forwardHeaders["x-api-key"] = apiKey;
      forwardHeaders["anthropic-version"] =
        incomingHeaders["anthropic-version"] ?? "2023-06-01";
    } else {
      forwardHeaders["authorization"] = `Bearer ${apiKey}`;
    }
  } else if (incomingHeaders["authorization"]) {
    forwardHeaders["authorization"] = incomingHeaders["authorization"];
  } else if (incomingHeaders["x-api-key"]) {
    forwardHeaders["x-api-key"] = incomingHeaders["x-api-key"];
  }

  if (incomingHeaders["anthropic-version"]) {
    forwardHeaders["anthropic-version"] = incomingHeaders["anthropic-version"];
  }

  try {
    const body =
      c.req.method !== "GET" && c.req.method !== "HEAD"
        ? await c.req.raw.arrayBuffer()
        : undefined;

    const upstream = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers: forwardHeaders,
      body: body ?? null,
      signal: AbortSignal.timeout(timeout),
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower !== "content-encoding" &&
        lower !== "transfer-encoding" &&
        lower !== "connection"
      ) {
        responseHeaders.set(key, value);
      }
    });

    responseHeaders.set("access-control-allow-origin", "*");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return c.json({ error: "Proxy request timed out" }, 504);
    }
    return c.json(
      {
        error: "Proxy request failed",
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
});

// ─── 404 fallback ────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;

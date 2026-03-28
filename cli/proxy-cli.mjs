#!/usr/bin/env node
/**
 * bolt.diy CLI Proxy Tool
 * Works on Windows / Mac / Linux — only requires Node.js (no pnpm needed)
 *
 * Commands:
 *   node cli/proxy-cli.mjs start         Start the proxy server
 *   node cli/proxy-cli.mjs config        Show current config
 *   node cli/proxy-cli.mjs config --set  key=val ...
 *   node cli/proxy-cli.mjs config --wizard
 *   node cli/proxy-cli.mjs test          Test the connection
 *   node cli/proxy-cli.mjs models        List available models
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = resolve(__dirname, ".proxy-config.json");

const C = {
  reset: "\x1b[0m", bright: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m",
};
const log = (color, ...args) => console.log(`${color}${args.join(" ")}${C.reset}`);

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  const defaults = { baseUrl: "", provider: "openai", apiKey: "", port: 8080, timeout: 30000, enabled: false };
  if (existsSync(CONFIG_FILE)) {
    try { return { ...defaults, ...JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) }; } catch {}
  }
  return defaults;
}

function saveConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function showConfig() {
  const c = loadConfig();
  log(C.bright, "\n─── Current Proxy Configuration ───\n");
  console.log(`  Provider : ${c.provider}`);
  console.log(`  Base URL : ${c.baseUrl || "(not set)"}`);
  console.log(`  API Key  : ${c.apiKey ? "***" + c.apiKey.slice(-4) : "(not set)"}`);
  console.log(`  Port     : ${c.port}`);
  console.log(`  Timeout  : ${c.timeout}ms`);
  console.log(`  Enabled  : ${c.enabled}`);
  console.log("");
}

function setConfig(args) {
  const c = loadConfig();
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq === -1) { log(C.yellow, `  Skipping: ${arg}`); continue; }
    const key = arg.slice(0, eq), val = arg.slice(eq + 1);
    if (key === "baseUrl") c.baseUrl = val;
    else if (key === "provider") c.provider = val;
    else if (key === "apiKey") c.apiKey = val;
    else if (key === "port") c.port = parseInt(val, 10);
    else if (key === "timeout") c.timeout = parseInt(val, 10);
    else if (key === "enabled") c.enabled = val === "true" || val === "1";
    else log(C.yellow, `  Unknown key: ${key}`);
  }
  saveConfig(c);
  log(C.green, "✓ Configuration saved");
  showConfig();
}

async function wizard() {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));
  log(C.bright, "\n─── Proxy Setup Wizard ───\n");
  console.log("Select provider:");
  console.log("  1) OpenAI (api.openai.com)");
  console.log("  2) Anthropic Claude (api.anthropic.com)");
  console.log("  3) Ollama local (http://localhost:11434/v1)");
  console.log("  4) LM Studio local (http://localhost:1234/v1)");
  console.log("  5) Custom / CLI Proxy API\n");
  const choice = await ask("Choice [1-5]: ");
  const map = {
    "1": { provider: "openai", defaultUrl: "https://api.openai.com" },
    "2": { provider: "anthropic", defaultUrl: "https://api.anthropic.com" },
    "3": { provider: "ollama", defaultUrl: "http://localhost:11434/v1" },
    "4": { provider: "lmstudio", defaultUrl: "http://localhost:1234/v1" },
    "5": { provider: "openai", defaultUrl: "http://localhost:8317/v1" },
  };
  const sel = map[choice.trim()] ?? map["5"];
  const c = loadConfig();
  c.provider = sel.provider;
  const urlIn = await ask(`Base URL [${sel.defaultUrl}]: `);
  c.baseUrl = urlIn.trim() || sel.defaultUrl;
  const keyIn = await ask("API Key (leave blank if not needed): ");
  c.apiKey = keyIn.trim();
  const portIn = await ask(`Server port [${c.port}]: `);
  c.port = parseInt(portIn.trim() || String(c.port), 10);
  c.enabled = true;
  rl.close();
  saveConfig(c);
  log(C.green, "\n✓ Configuration saved!\n");
  showConfig();
  log(C.cyan, `Run: node cli/proxy-cli.mjs start\n`);
}

// ─── Embedded Proxy Server ───────────────────────────────────────────────────

function buildAuthHeaders(config, incomingHeaders) {
  const h = {
    "content-type": (incomingHeaders["content-type"]) ?? "application/json",
    "accept": (incomingHeaders["accept"]) ?? "application/json",
  };
  if (config.apiKey) {
    if (config.provider === "anthropic") {
      h["x-api-key"] = config.apiKey;
      h["anthropic-version"] = incomingHeaders["anthropic-version"] ?? "2023-06-01";
    } else {
      h["authorization"] = `Bearer ${config.apiKey}`;
    }
  } else if (incomingHeaders["authorization"]) {
    h["authorization"] = incomingHeaders["authorization"];
  } else if (incomingHeaders["x-api-key"]) {
    h["x-api-key"] = incomingHeaders["x-api-key"];
  }
  if (incomingHeaders["anthropic-version"]) h["anthropic-version"] = incomingHeaders["anthropic-version"];
  return h;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(body);
}

function startEmbeddedServer(config) {
  const server = http.createServer((req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
        "access-control-allow-headers": "Content-Type,Authorization,X-Api-Key,Anthropic-Version",
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${config.port}`);
    const path = url.pathname;

    // ── Health ──
    if (path === "/api/healthz" && req.method === "GET") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    // ── Config ──
    if (path === "/api/config" && req.method === "GET") {
      sendJson(res, 200, {
        proxy: {
          enabled: config.enabled,
          baseUrl: config.baseUrl ? "[configured]" : "[not set]",
          provider: config.provider,
          timeout: config.timeout,
          apiKeySet: Boolean(config.apiKey),
        },
      });
      return;
    }

    // ── Models ──
    if (path === "/api/models" && req.method === "GET") {
      if (!config.enabled || !config.baseUrl) {
        sendJson(res, 200, { models: [], message: "Proxy not configured." });
        return;
      }
      const modelsUrl = new URL(`${config.baseUrl.replace(/\/$/, "")}/v1/models`);
      const headers = buildAuthHeaders(config, {});
      const protocol = modelsUrl.protocol === "https:" ? https : http;
      const preq = protocol.request(modelsUrl, { method: "GET", headers }, (pres) => {
        let data = "";
        pres.on("data", (c) => (data += c));
        pres.on("end", () => {
          try { const parsed = JSON.parse(data); res.writeHead(200, {"content-type":"application/json","access-control-allow-origin":"*"}); res.end(JSON.stringify(parsed)); }
          catch { sendJson(res, 200, { raw: data }); }
        });
      });
      preq.on("error", (e) => sendJson(res, 502, { error: e.message }));
      preq.setTimeout(10000, () => { preq.destroy(); sendJson(res, 504, { error: "Timed out" }); });
      preq.end();
      return;
    }

    // ── Proxy ──
    if (path.startsWith("/api/proxy/")) {
      if (!config.enabled) { sendJson(res, 503, { error: "Proxy disabled. Run config --set enabled=true" }); return; }
      if (!config.baseUrl) { sendJson(res, 500, { error: "PROXY_BASE_URL not set." }); return; }

      const subPath = path.replace(/^\/api\/proxy\/?/, "");
      let targetUrl;
      try {
        targetUrl = new URL(`${config.baseUrl.replace(/\/$/, "")}/${subPath}`);
        url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));
      } catch (e) {
        sendJson(res, 500, { error: "Invalid target URL: " + e.message });
        return;
      }

      const reqHeaders = req.headers;
      const forwardHeaders = buildAuthHeaders(config, reqHeaders);

      let body = Buffer.alloc(0);
      req.on("data", (chunk) => { body = Buffer.concat([body, chunk]); });
      req.on("end", () => {
        let isStream = false;
        try { isStream = JSON.parse(body.toString())?.stream === true; } catch {}

        forwardHeaders["content-length"] = String(body.length);
        const protocol = targetUrl.protocol === "https:" ? https : http;
        const preq = protocol.request(
          targetUrl,
          { method: req.method, headers: forwardHeaders, timeout: config.timeout },
          (pres) => {
            const outHeaders = { "access-control-allow-origin": "*" };
            for (const [k, v] of Object.entries(pres.headers)) {
              const l = k.toLowerCase();
              if (l !== "content-encoding" && l !== "transfer-encoding" && l !== "connection") {
                outHeaders[k] = v;
              }
            }
            res.writeHead(pres.statusCode ?? 200, outHeaders);
            if (isStream) {
              pres.pipe(res);
            } else {
              let data = Buffer.alloc(0);
              pres.on("data", (c) => { data = Buffer.concat([data, c]); });
              pres.on("end", () => res.end(data));
            }
          }
        );
        preq.on("timeout", () => { preq.destroy(); if (!res.writableEnded) sendJson(res, 504, { error: "Proxy timed out" }); });
        preq.on("error", (e) => { if (!res.writableEnded) sendJson(res, 502, { error: e.message }); });
        if (req.method !== "GET" && req.method !== "HEAD") preq.write(body);
        preq.end();
      });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  server.listen(config.port, () => {
    log(C.green, `\n✓ Proxy server running on http://localhost:${config.port}\n`);
    log(C.cyan, "  Endpoints:");
    console.log(`    GET  http://localhost:${config.port}/api/healthz`);
    console.log(`    GET  http://localhost:${config.port}/api/config`);
    console.log(`    GET  http://localhost:${config.port}/api/models`);
    console.log(`    ANY  http://localhost:${config.port}/api/proxy/v1/chat/completions`);
    console.log("");
    log(C.yellow, "  Press Ctrl+C to stop\n");
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      log(C.red, `✗ Port ${config.port} is already in use. Try: --set port=8081`);
    } else {
      log(C.red, "✗ Server error:", e.message);
    }
    process.exit(1);
  });
}

function startServer() {
  const config = loadConfig();
  log(C.bright, "\n─── Starting bolt.diy Proxy Server ───\n");
  if (!config.enabled) log(C.yellow, "⚠  Proxy disabled. Run: node cli/proxy-cli.mjs config --set enabled=true\n");
  log(C.cyan, `  Provider : ${config.provider}`);
  log(C.cyan, `  Base URL : ${config.baseUrl || "(not set)"}`);
  log(C.cyan, `  Port     : ${config.port}`);
  log(C.cyan, `  Enabled  : ${config.enabled}\n`);
  startEmbeddedServer(config);
}

// ─── Test ────────────────────────────────────────────────────────────────────

function testConnection() {
  const config = loadConfig();
  log(C.blue, `\nTesting http://localhost:${config.port}/api/healthz ...\n`);
  const req = http.get(`http://localhost:${config.port}/api/healthz`, (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      try {
        if (JSON.parse(data).status === "ok") log(C.green, `✓ Server is running on port ${config.port}`);
        else log(C.yellow, `? Response: ${data}`);
      } catch { log(C.yellow, `? Unexpected: ${data}`); }
    });
  });
  req.on("error", () => { log(C.red, `✗ Server not running. Start with: node cli/proxy-cli.mjs start`); });
  req.setTimeout(3000, () => { req.destroy(); log(C.red, "✗ Timed out"); });
}

function listModels() {
  const config = loadConfig();
  const req = http.get(`http://localhost:${config.port}/api/models`, (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      try {
        const d = JSON.parse(data);
        if (Array.isArray(d.data)) {
          log(C.bright, "\n─── Available Models ───\n");
          d.data.forEach((m) => console.log(`  • ${m.id}`));
          console.log("");
        } else { console.log(JSON.stringify(d, null, 2)); }
      } catch { console.log(data); }
    });
  });
  req.on("error", () => log(C.red, "✗ Server not running. Start with: node cli/proxy-cli.mjs start"));
}

function showHelp() {
  log(C.bright, "\nbolt.diy CLI Proxy (no pnpm required)\n");
  console.log("Usage: node cli/proxy-cli.mjs <command>\n");
  console.log("  start                   Start the proxy server (embedded, no build needed)");
  console.log("  config                  Show current config");
  console.log("  config --set key=val    Set config values");
  console.log("  config --wizard         Interactive setup");
  console.log("  test                    Test if server is running");
  console.log("  models                  List models from configured provider\n");
  console.log("Quick start:");
  console.log("  node cli/proxy-cli.mjs config --set baseUrl=http://localhost:8317/v1 apiKey=your-api-key-1 enabled=true");
  console.log("  node cli/proxy-cli.mjs start\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;
switch (cmd) {
  case "start": startServer(); break;
  case "config":
    if (rest[0] === "--set") setConfig(rest.slice(1));
    else if (rest[0] === "--wizard") wizard().catch(console.error);
    else showConfig();
    break;
  case "test": testConnection(); break;
  case "models": listModels(); break;
  default: showHelp(); break;
}

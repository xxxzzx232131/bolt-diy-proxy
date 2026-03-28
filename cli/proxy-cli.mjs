#!/usr/bin/env node
/**
 * bolt.diy CLI Proxy Tool
 *
 * Usage:
 *   node cli/proxy-cli.mjs [command] [options]
 *
 * Commands:
 *   start         Start the proxy server
 *   config        Show or set proxy configuration
 *   test          Test the proxy connection
 *   models        List available models from the configured provider
 *   help          Show this help message
 *
 * Examples:
 *   node cli/proxy-cli.mjs start
 *   node cli/proxy-cli.mjs config --set baseUrl=http://localhost:11434/v1 provider=ollama
 *   node cli/proxy-cli.mjs test
 *   node cli/proxy-cli.mjs models
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = resolve(__dirname, ".proxy-config.json");
const ROOT_DIR = resolve(__dirname, "..");
const ENV_FILE = resolve(ROOT_DIR, ".env");

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(color, ...args) {
  console.log(`${color}${args.join(" ")}${COLORS.reset}`);
}

function loadConfig() {
  const defaults = {
    baseUrl: "",
    provider: "openai",
    apiKey: "",
    port: 8080,
    timeout: 30000,
    enabled: false,
  };

  if (existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  }
  return defaults;
}

function saveConfig(config) {
  const { apiKey: _apiKey, ...safeConfig } = config;
  writeFileSync(CONFIG_FILE, JSON.stringify(safeConfig, null, 2));
}

function buildEnvContent(config) {
  const existing = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, "utf-8")
        .split("\n")
        .filter((l) => !l.startsWith("PROXY_"))
        .join("\n")
    : "";

  const proxyEnv = [
    `PROXY_ENABLED=${config.enabled}`,
    `PROXY_BASE_URL=${config.baseUrl}`,
    `PROXY_PROVIDER=${config.provider}`,
    `PROXY_API_KEY=${config.apiKey ?? ""}`,
    `PROXY_TIMEOUT=${config.timeout}`,
    `PORT=${config.port}`,
  ].join("\n");

  return existing.trim() ? `${existing.trim()}\n${proxyEnv}\n` : `${proxyEnv}\n`;
}

function writeEnv(config) {
  writeFileSync(ENV_FILE, buildEnvContent(config));
  log(COLORS.green, `✓ Environment written to ${ENV_FILE}`);
}

function showHelp() {
  log(COLORS.bright, "\nbolt.diy CLI Proxy Tool\n");
  console.log("Usage: node cli/proxy-cli.mjs <command> [options]\n");
  console.log("Commands:");
  console.log("  start                     Start the proxy + API server");
  console.log("  config                    Show current proxy configuration");
  console.log("  config --set key=val ...  Set one or more config values");
  console.log("  config --wizard           Interactive setup wizard");
  console.log("  test                      Test the proxy connection");
  console.log("  models                    List models from configured provider");
  console.log("  help                      Show this help\n");
  console.log("Config keys:");
  console.log("  baseUrl   Base URL of the provider API (e.g. http://localhost:11434/v1)");
  console.log("  provider  Provider type: openai | anthropic | ollama | lmstudio | custom");
  console.log("  apiKey    API key for authentication");
  console.log("  port      Local server port (default: 8080)");
  console.log("  timeout   Request timeout in ms (default: 30000)");
  console.log("  enabled   Enable or disable the proxy: true | false\n");
  console.log("Examples:");
  console.log("  # Use Ollama (local, no API key needed)");
  console.log(
    "  node cli/proxy-cli.mjs config --set baseUrl=http://localhost:11434/v1 provider=ollama enabled=true",
  );
  console.log("");
  console.log("  # Use LM Studio (local)");
  console.log(
    "  node cli/proxy-cli.mjs config --set baseUrl=http://localhost:1234/v1 provider=lmstudio enabled=true",
  );
  console.log("");
  console.log("  # Use OpenAI");
  console.log(
    "  node cli/proxy-cli.mjs config --set baseUrl=https://api.openai.com provider=openai apiKey=sk-... enabled=true",
  );
  console.log("");
  console.log("  # Use Anthropic Claude");
  console.log(
    "  node cli/proxy-cli.mjs config --set baseUrl=https://api.anthropic.com provider=anthropic apiKey=sk-ant-... enabled=true",
  );
  console.log("");
}

function showConfig() {
  const config = loadConfig();
  log(COLORS.bright, "\n─── Current Proxy Configuration ───\n");
  console.log(`  Provider : ${config.provider}`);
  console.log(`  Base URL : ${config.baseUrl || "(not set)"}`);
  console.log(`  API Key  : ${config.apiKey ? "***" + config.apiKey.slice(-4) : "(not set)"}`);
  console.log(`  Port     : ${config.port}`);
  console.log(`  Timeout  : ${config.timeout}ms`);
  console.log(`  Enabled  : ${config.enabled}`);
  console.log("");
}

function setConfig(args) {
  const config = loadConfig();

  for (const arg of args) {
    const eqIdx = arg.indexOf("=");
    if (eqIdx === -1) {
      log(COLORS.yellow, `  Skipping invalid argument: ${arg} (expected key=value)`);
      continue;
    }
    const key = arg.slice(0, eqIdx);
    const value = arg.slice(eqIdx + 1);

    switch (key) {
      case "baseUrl":
        config.baseUrl = value;
        break;
      case "provider":
        config.provider = value;
        break;
      case "apiKey":
        config.apiKey = value;
        break;
      case "port":
        config.port = parseInt(value, 10);
        break;
      case "timeout":
        config.timeout = parseInt(value, 10);
        break;
      case "enabled":
        config.enabled = value === "true" || value === "1";
        break;
      default:
        log(COLORS.yellow, `  Unknown config key: ${key}`);
    }
  }

  saveConfig(config);
  writeEnv(config);
  log(COLORS.green, "✓ Configuration saved");
  showConfig();
}

async function wizard() {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  log(COLORS.bright, "\n─── Proxy Setup Wizard ───\n");

  const config = loadConfig();

  console.log("Select provider:");
  console.log("  1) OpenAI (api.openai.com)");
  console.log("  2) Anthropic Claude (api.anthropic.com)");
  console.log("  3) Ollama (local, e.g. http://localhost:11434/v1)");
  console.log("  4) LM Studio (local, e.g. http://localhost:1234/v1)");
  console.log("  5) Custom URL\n");

  const choice = await ask("Choice [1-5]: ");

  const providerMap = {
    "1": { provider: "openai", defaultUrl: "https://api.openai.com" },
    "2": { provider: "anthropic", defaultUrl: "https://api.anthropic.com" },
    "3": { provider: "ollama", defaultUrl: "http://localhost:11434/v1" },
    "4": { provider: "lmstudio", defaultUrl: "http://localhost:1234/v1" },
    "5": { provider: "custom", defaultUrl: "" },
  };

  const selected = providerMap[choice.trim()] ?? providerMap["1"];
  config.provider = selected.provider;

  const urlInput = await ask(`Base URL [${selected.defaultUrl}]: `);
  config.baseUrl = urlInput.trim() || selected.defaultUrl;

  if (config.provider !== "ollama" && config.provider !== "lmstudio") {
    const keyInput = await ask("API Key (leave blank to skip): ");
    config.apiKey = keyInput.trim();
  }

  const portInput = await ask(`Server port [${config.port}]: `);
  config.port = parseInt(portInput.trim() || String(config.port), 10);

  config.enabled = true;

  rl.close();

  saveConfig(config);
  writeEnv(config);

  log(COLORS.green, "\n✓ Wizard complete! Configuration saved.\n");
  showConfig();
  log(COLORS.cyan, "Run: node cli/proxy-cli.mjs start\n");
}

function testConnection(config) {
  return new Promise((resolve) => {
    const apiBase = `http://localhost:${config.port}`;
    log(COLORS.blue, `\nTesting proxy at ${apiBase}/api/proxy/...\n`);

    const req = http.get(`${apiBase}/api/healthz`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status === "ok") {
            log(COLORS.green, `✓ API server is running (port ${config.port})`);
          } else {
            log(COLORS.yellow, `? API server responded: ${data}`);
          }
        } catch {
          log(COLORS.yellow, `? Unexpected response: ${data}`);
        }
        resolve(true);
      });
    });

    req.on("error", () => {
      log(COLORS.red, `✗ API server not reachable at ${apiBase}`);
      log(COLORS.yellow, "  Run: node cli/proxy-cli.mjs start\n");
      resolve(false);
    });

    req.setTimeout(3000, () => {
      req.destroy();
      log(COLORS.red, "✗ Connection timed out");
      resolve(false);
    });
  });
}

function fetchModels(config) {
  return new Promise((resolve) => {
    const apiBase = `http://localhost:${config.port}`;
    const req = http.get(`${apiBase}/api/models`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed.data)) {
            log(COLORS.bright, "\n─── Available Models ───\n");
            for (const model of parsed.data) {
              console.log(`  • ${model.id}`);
            }
            console.log("");
          } else if (parsed.message) {
            log(COLORS.yellow, `\n${parsed.message}\n`);
          } else {
            console.log(JSON.stringify(parsed, null, 2));
          }
        } catch {
          console.log(data);
        }
        resolve(true);
      });
    });

    req.on("error", () => {
      log(COLORS.red, "✗ Could not reach API server. Is it running?");
      resolve(false);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      log(COLORS.red, "✗ Timed out fetching models");
      resolve(false);
    });
  });
}

function startServer() {
  const config = loadConfig();
  writeEnv(config);

  log(COLORS.bright, "\n─── Starting bolt.diy API Proxy Server ───\n");

  if (!config.enabled) {
    log(COLORS.yellow, "⚠  Proxy is disabled. Run: node cli/proxy-cli.mjs config --set enabled=true");
  }

  log(COLORS.cyan, `  Provider : ${config.provider}`);
  log(COLORS.cyan, `  Base URL : ${config.baseUrl || "(not set)"}`);
  log(COLORS.cyan, `  Port     : ${config.port}`);
  log(COLORS.cyan, `  Enabled  : ${config.enabled}`);
  console.log("");

  const proc = spawn("pnpm", ["--filter", "@workspace/api-server", "run", "dev"], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      PROXY_ENABLED: String(config.enabled),
      PROXY_BASE_URL: config.baseUrl,
      PROXY_PROVIDER: config.provider,
      PROXY_API_KEY: config.apiKey ?? "",
      PROXY_TIMEOUT: String(config.timeout),
      PORT: String(config.port),
    },
  });

  proc.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

const [, , cmd, ...rest] = process.argv;

switch (cmd) {
  case "start":
    startServer();
    break;
  case "config":
    if (rest[0] === "--set") {
      setConfig(rest.slice(1));
    } else if (rest[0] === "--wizard") {
      wizard().catch(console.error);
    } else {
      showConfig();
    }
    break;
  case "test": {
    const config = loadConfig();
    testConnection(config).then((ok) => process.exit(ok ? 0 : 1));
    break;
  }
  case "models": {
    const config = loadConfig();
    fetchModels(config).then((ok) => process.exit(ok ? 0 : 1));
    break;
  }
  case "help":
  case "--help":
  case "-h":
  default:
    showHelp();
    break;
}

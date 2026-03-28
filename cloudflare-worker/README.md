# bolt.diy — Cloudflare Workers Proxy

A lightweight AI proxy built on Cloudflare Workers using Hono.  
Zero Node.js dependencies — runs natively on the Cloudflare edge.

## Features

- Proxies AI API calls to any provider (OpenAI, Anthropic, Ollama, LM Studio, etc.)
- Streaming support (SSE / chunked responses)
- Secrets stored in Cloudflare's encrypted secrets store
- Deployed globally across Cloudflare's edge in seconds
- No cold-start issues (no server to manage)

## Quick Start

### 1. Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2. Install dependencies

```bash
cd cloudflare-worker
npm install
```

### 3. Configure local dev

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your API keys
```

### 4. Run locally

```bash
npm run dev
# Worker runs at http://localhost:8787
```

### 5. Deploy to Cloudflare

```bash
# Set secrets in Cloudflare (do NOT put secrets in wrangler.toml)
wrangler secret put PROXY_BASE_URL
wrangler secret put PROXY_API_KEY
wrangler secret put PROXY_ENABLED

# Deploy
npm run deploy
```

## API Reference

All endpoints are prefixed with `/api/`.

| Endpoint | Method | Description |
|---|---|---|
| `/api/healthz` | GET | Health check |
| `/api/config` | GET | View proxy settings (no secrets exposed) |
| `/api/config/validate` | POST | Validate config values |
| `/api/models` | GET | List models from configured provider |
| `/api/proxy/*` | ALL | Proxy to configured upstream |

## Provider Examples

### OpenAI

```bash
wrangler secret put PROXY_BASE_URL
# Enter: https://api.openai.com

wrangler secret put PROXY_API_KEY
# Enter: sk-...

wrangler secret put PROXY_ENABLED
# Enter: true

wrangler secret put PROXY_PROVIDER
# Enter: openai
```

### Anthropic Claude

```bash
wrangler secret put PROXY_BASE_URL
# Enter: https://api.anthropic.com

wrangler secret put PROXY_API_KEY
# Enter: sk-ant-...

wrangler secret put PROXY_PROVIDER
# Enter: anthropic
```

### Ollama (local via Cloudflare Tunnel)

First expose your local Ollama with cloudflared:
```bash
cloudflared tunnel --url http://localhost:11434
```

Then:
```bash
wrangler secret put PROXY_BASE_URL
# Enter: https://your-tunnel.trycloudflare.com

wrangler secret put PROXY_PROVIDER
# Enter: ollama
```

## Usage

Once deployed, send requests through the proxy:

```bash
# Chat completion
curl -X POST https://your-worker.workers.dev/api/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'

# List models
curl https://your-worker.workers.dev/api/models

# Health check
curl https://your-worker.workers.dev/api/healthz
```

## Custom Domain

To use a custom domain:
1. Go to Cloudflare Dashboard → Workers → your worker → Settings → Domains & Routes
2. Add a custom domain (e.g. `ai.yourdomain.com`)

Or update `wrangler.toml`:
```toml
[[routes]]
pattern = "ai.yourdomain.com/*"
zone_name = "yourdomain.com"
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PROXY_ENABLED` | Yes | `false` | Enable the proxy |
| `PROXY_BASE_URL` | Yes | — | Upstream provider base URL |
| `PROXY_API_KEY` | No | — | API key (leave blank for local providers) |
| `PROXY_PROVIDER` | No | `openai` | Provider type |
| `PROXY_TIMEOUT` | No | `30000` | Timeout in ms |

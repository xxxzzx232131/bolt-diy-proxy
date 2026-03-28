# Docker Deployment Guide

## Quick Start with Docker Desktop

### Prerequisites
- Docker Desktop installed and running
- (Optional) API keys for your chosen AI provider

### 1. Clone and configure

```bash
git clone https://github.com/stackblitz-labs/bolt.diy
cd bolt.diy
cp .env.example .env
```

### 2. Configure your AI provider

Edit `.env` and set your provider details:

#### Ollama (local, no API key needed)
```env
PROXY_ENABLED=true
PROXY_BASE_URL=http://host.docker.internal:11434/v1
PROXY_PROVIDER=ollama
```

#### LM Studio (local)
```env
PROXY_ENABLED=true
PROXY_BASE_URL=http://host.docker.internal:1234/v1
PROXY_PROVIDER=lmstudio
```

#### OpenAI
```env
PROXY_ENABLED=true
PROXY_BASE_URL=https://api.openai.com
PROXY_PROVIDER=openai
PROXY_API_KEY=sk-...
```

#### Anthropic Claude
```env
PROXY_ENABLED=true
PROXY_BASE_URL=https://api.anthropic.com
PROXY_PROVIDER=anthropic
PROXY_API_KEY=sk-ant-...
```

### 3. Start with Docker Desktop

Double-click `docker-compose.yml` in Docker Desktop, or run:

```bash
docker compose up -d
```

The API server will be available at: **http://localhost:8080**

### 4. Verify it's running

```bash
curl http://localhost:8080/api/healthz
# {"status":"ok"}

curl http://localhost:8080/api/config
# Shows current proxy configuration

curl http://localhost:8080/api/models
# Lists available models from your provider
```

### 5. Using the proxy

Send AI requests through the proxy:

```bash
curl -X POST http://localhost:8080/api/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## CLI Tool

You can also use the CLI tool instead of Docker:

```bash
# Setup wizard
node cli/proxy-cli.mjs config --wizard

# Or set config directly
node cli/proxy-cli.mjs config --set \
  baseUrl=http://localhost:11434/v1 \
  provider=ollama \
  enabled=true

# Start the server
node cli/proxy-cli.mjs start

# Test the connection
node cli/proxy-cli.mjs test

# List models
node cli/proxy-cli.mjs models
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/healthz` | GET | Health check |
| `/api/config` | GET | View proxy config (safe, no secrets) |
| `/api/config/validate` | POST | Validate config values |
| `/api/models` | GET | List models from configured provider |
| `/api/proxy/*` | ALL | Proxy to configured upstream |

## Stopping

```bash
docker compose down
```

To also remove the database volume:
```bash
docker compose down -v
```

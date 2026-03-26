<div align="center">

# 🔌 n8n-custom-mcp

**Full-power MCP Server for n8n — 36 tools for AI agents to build, deploy, debug, and fix workflows autonomously.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://docker.com/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![n8n](https://img.shields.io/badge/n8n-API%20v1-orange.svg)](https://docs.n8n.io/api/)

[Features](#-features) · [Quick Start](#-quick-start) · [Tools](#-tools-36) · [Self-Healing Loop](#-self-healing-deploy-loop) · [Contributing](#-contributing)

</div>

## ❓ Why this exists?

Existing n8n MCP servers only support **reading and running** workflows. You can't create, edit, debug, or fix workflows from an AI agent.

**n8n-custom-mcp** solves this by providing **36 tools** covering the entire workflow lifecycle — enabling a fully autonomous **Deploy → Diagnose → Test → Debug → Fix → Redeploy** loop:

| Capability | Other MCP Servers | n8n-custom-mcp |
|:---------|:---:|:---:|
| List & View workflows | ✅ | ✅ |
| Run workflows | ✅ | ✅ |
| Activate / Deactivate | ✅ | ✅ |
| **Create workflows** | ❌ | ✅ |
| **Edit workflows** | ❌ | ✅ |
| **Surgical node patching** | ❌ | ✅ |
| **Pre-deploy validation** | ❌ | ✅ |
| **Execute & wait for results** | ❌ | ✅ |
| **Deep execution debugging** | ❌ | ✅ |
| **Credential management** | ❌ | ✅ |
| **Node schema discovery** | ❌ | ✅ |
| **Template import** | ❌ | ✅ |
| **Webhook testing** | ❌ | ✅ |
| **Tag management** | ❌ | ✅ |
| **Deep workflow diagnosis** | ❌ | ✅ |
| **Node version discovery** | ❌ | ✅ |
| **Execution cleanup** | ❌ | ✅ |

## 🚀 Features

### 🔄 Self-Healing Deploy Loop
AI agent autonomously: deploy → execute → analyze errors → patch failing nodes → re-execute until success. No human intervention needed.

### 🔧 Surgical Node Editing
`patch_workflow_node` updates a single node's parameters/credentials without touching the rest of the workflow JSON — eliminating corruption risk.

### 🔍 Deep Debugging
`get_execution_data` with `errorsOnly` filter, stack traces, HTTP codes, and item-level error extraction for precise root cause analysis.

### 📋 Schema Discovery
`get_node_schema` queries n8n's internal API for complete parameter definitions — know exactly what fields any node type accepts.

### 📦 One-Step Template Import
`import_template` fetches a community template from n8n.io and deploys it as a workflow in one call.

### 🐳 Docker-Ready
Multi-stage Dockerfile with [supergateway](https://github.com/nichochar/supergateway) to expose MCP via HTTP — just `docker compose up`.

## 📦 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)
- n8n instance running (or via same docker-compose)
- [n8n API Key](https://docs.n8n.io/api/authentication/)

### Step 1: Clone

```bash
git clone https://github.com/duyasia/n8n-custom-mcp.git
cd n8n-custom-mcp
```

### Step 2: Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
N8N_HOST=http://n8n:5678       # Docker internal URL
N8N_API_KEY=your_api_key_here  # Create at n8n → Settings → API
```

### Step 3: Run

**Standalone (MCP server only):**

```bash
docker compose up -d --build
```

**Integrate into existing n8n stack:**

Add this service to your `docker-compose.yml`:

```yaml
n8n-mcp:
  build:
    context: ./n8n-custom-mcp
  restart: always
  ports:
    - "3000:3000"
  environment:
    - N8N_HOST=http://n8n:5678
    - N8N_API_KEY=${N8N_API_KEY}
  depends_on:
    n8n:
      condition: service_started
  command: >
    --stdio "node dist/index.js"
    --port 3000
    --outputTransport streamableHttp
    --streamableHttpPath /mcp
    --cors
```

### Step 4: Connect your AI agent

| Field | Value |
|:------|:------|
| Type | MCP (Streamable HTTP) |
| URL | `http://<your-host>:3000/mcp` |

You should see **36 tools** available. ✅

## 🛠 Tools (36)

### Workflow Management (7)

| Tool | Description |
|:-----|:-----------|
| `list_workflows` | List workflows, filter by active status, tags, limit |
| `get_workflow` | Get full workflow JSON (nodes, connections, settings) |
| `create_workflow` | Create a new workflow from JSON definition |
| `update_workflow` | Update an existing workflow |
| `delete_workflow` | Delete a workflow |
| `activate_workflow` | Activate or deactivate a workflow |
| `duplicate_workflow` | Clone a workflow (created inactive) |

### Execution & Testing (3)

| Tool | Description |
|:-----|:-----------|
| `execute_workflow` | Trigger workflow execution via Runner Bridge |
| `execute_workflow_and_wait` | Execute via internal API + auto-poll until complete (max 10 min) |
| `trigger_webhook` | Call webhook endpoints (supports test mode) |

### Debugging & Monitoring (5)

| Tool | Description |
|:-----|:-----------|
| `list_executions` | List execution history, filter by status/workflow |
| `get_execution` | Get full execution details |
| `get_execution_data` | Per-node forensic data: errors, stack traces, HTTP codes, item errors |
| `delete_execution` | Delete stuck/zombie executions (single or bulk) |
| `list_node_types` | Discover all node types used across workflows |

### Community Templates (3)

| Tool | Description |
|:-----|:-----------|
| `search_templates` | Search n8n.io community templates |
| `get_template` | Get full template definition for manual import |
| `import_template` | One-step: fetch template → create workflow |

### Credential Management (5)

| Tool | Description |
|:-----|:-----------|
| `list_credentials` | List all credentials (with pagination) |
| `get_credential_schema` | Discover credential types by scanning workflows |
| `create_credential` | Create a new credential |
| `update_credential` | Update credential data without breaking references |
| `delete_credential` | Delete a credential |

### Node Schema Discovery (3)

| Tool | Description |
|:-----|:-----------|
| `get_node_type_details` | Get node config examples from existing workflows (scan-based) |
| `get_node_schema` | Get official parameter schema from n8n internal API |
| `get_node_versions` | Discover all available typeVersions for a node type (latest + history) |

### Tag Management (5)

| Tool | Description |
|:-----|:-----------|
| `list_tags` | List all tags |
| `create_tag` | Create a new tag |
| `update_tag` | Rename a tag |
| `delete_tag` | Delete a tag |
| `tag_workflow` | Assign tags to a workflow |

### Surgical Editing & Validation (3)

| Tool | Description |
|:-----|:-----------|
| `patch_workflow_node` | Update a single node's params/credentials without touching the rest |
| `validate_workflow` | Check for structural issues before deploying |
| `diagnose_workflow` | Deep health check: credentials, sandbox, versions, connections, orphans |

### Productivity (2)

| Tool | Description |
|:-----|:-----------|
| `get_workflow_summary` | Human-readable workflow overview (nodes, flow, creds) |
| `clone_credentials` | Copy credential assignments between workflows by node type |

## 🔄 Self-Healing Deploy Loop

This is the core pattern that makes n8n-custom-mcp powerful. An AI agent can autonomously fix failing workflows:

```
Agent receives task
  → get_node_versions         (get latest typeVersion — CRITICAL)
  → get_node_schema           (know correct parameters)
  → import_template           (start from community template)
  → list_credentials          (find existing credentials)
  → clone_credentials         (auto-assign credentials)
  → diagnose_workflow         (deep pre-execute check — NEW v2.5.0)
  → execute_workflow_and_wait (run + get results in one step)
  → FAILED?
      → get_execution_data(errorsOnly: true)   (root cause)
      → patch_workflow_node                    (fix single node)
      → execute_workflow_and_wait              (verify fix)
  → SUCCESS! ✅
```

**v1.0**: 12 tools, manual everything.
**v2.4.0**: 33 tools, self-healing loop with zero corruption risk.
**v2.5.0**: 36 tools, diagnose-first pattern + node version safety.

## 🏗 Architecture

```
AI Agent (Claude, GPT, Gemini, etc.)
       │
       │  MCP (Streamable HTTP)
       ▼
┌──────────────────────┐
│   n8n-custom-mcp     │
│   (supergateway)     │
│   :3000/mcp          │
│                      │
│   36 MCP Tools       │
│   TypeScript + Axios │
│   4 API Clients:     │
│   • n8n REST API     │
│   • Webhook Client   │
│   • n8n Internal API │
│   • n8n.io Templates │
└──────────┬───────────┘
           │  REST API (Docker internal)
           ▼
┌──────────────────────┐
│   n8n Instance       │
│   :5678              │
│   PostgreSQL + Redis │
└──────────────────────┘
```

## ⚙️ Configuration

| Variable | Required | Default | Description |
|:---------|:--------:|:--------|:-----------|
| `N8N_HOST` | ✅ | `http://localhost:5678` | URL to n8n instance |
| `N8N_API_KEY` | ✅ | — | API Key from n8n Settings |
| `PORT` | ❌ | `3000` | Port for MCP HTTP endpoint |

## 🔒 Security

- ⚠️ **NEVER** hardcode API keys in source code
- `.env` is included in `.gitignore`
- MCP server communicates with n8n via Docker internal network
- Webhook client does **not** send API keys (simulates external requests)

## 🤝 Contributing

All contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

Ideas for contribution:
- [ ] Deep merge for `patch_workflow_node` (currently shallow merge)
- [ ] Webhook callback pattern for long-running workflows (>10 min)
- [ ] Unit tests
- [ ] SSE transport support
- [ ] Rate limiting
- [ ] Authentication layer for MCP endpoint

## 📝 License

[MIT License](LICENSE) — Free for personal and commercial use.

## 🙏 Credits

- Inspired by [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp)
- n8n knowledge from [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills)
- MCP Protocol: [modelcontextprotocol.io](https://modelcontextprotocol.io/)
- [n8n](https://n8n.io/) — Workflow Automation Platform

---

<div align="center">

**If useful, please ⭐ star the repo!**

Made with ❤️ by [duyasia](https://github.com/duyasia)

</div>
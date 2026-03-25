# 🤝 Contributing to n8n-custom-mcp

Thank you for your interest in contributing! All contributions are welcome.

## 📋 How to Contribute

### 1. Fork & Clone

```bash
git clone https://github.com/<your-username>/n8n-custom-mcp.git
cd n8n-custom-mcp
npm install
```

### 2. Create a branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 3. Develop

```bash
# Set environment variables (needs a running n8n instance)
export N8N_HOST=http://localhost:5678
export N8N_API_KEY=your_key

# Build TypeScript
npm run build

# Run directly
node dist/index.js
```

### 4. Build & Test

```bash
# TypeScript type check
npx tsc --noEmit

# Build
npm run build

# Test with Docker
docker build -t n8n-custom-mcp-test .
docker run --rm \
  -e N8N_HOST=http://host.docker.internal:5678 \
  -e N8N_API_KEY=your_key \
  n8n-custom-mcp-test
```

### 5. Commit & Push

```bash
git add .
git commit -m "feat: short description"
git push origin feature/your-feature-name
```

### 6. Create a Pull Request

Open a PR on GitHub with a clear description of your changes.

## 📁 Project Structure

```
n8n-custom-mcp/
├── src/
│   └── index.ts             ← All MCP server logic (34 tools, ~1830 lines)
├── docs/
│   ├── USAGE.md             ← Advanced usage guide
│   └── runner-workflow.json ← Required n8n workflow for execution tools
├── package.json             ← Dependencies (MCP SDK, axios)
├── tsconfig.json
├── Dockerfile               ← Multi-stage build (builder + supergateway)
├── docker-compose.yml
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── CONTRIBUTING.md
├── README.md
└── LICENSE
```

### Key Architecture

The server uses **4 axios clients**:

| Client | Base URL | Purpose |
|:-------|:---------|:--------|
| `n8n` | `N8N_HOST/api/v1` | Public REST API (workflows, executions, credentials, tags) |
| `webhookClient` | `N8N_HOST` | Webhook triggers and Runner Bridge execution |
| `n8nInternal` | `N8N_HOST` | Internal API (`/rest/node-types`) for schema discovery |
| `n8nTemplates` | `api.n8n.io` | Community templates (public, no auth) |

## 🎯 Adding a New MCP Tool

Two places to edit in `src/index.ts`:

**1. Register the tool** — in the `ListToolsRequestSchema` handler (~line 55):

```typescript
{
  name: 'your_new_tool',
  description: 'Clear description for AI agent consumption',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'What this param does' },
    },
    required: ['param1'],
  },
},
```

**2. Implement the handler** — in the `CallToolRequestSchema` handler (~line 490):

```typescript
if (name === 'your_new_tool') {
  const { param1 } = args as any;
  try {
    const response = await n8n.get(`/endpoint/${param1}`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          data: response.data,
          hint: 'Actionable hint for the AI agent.',
        }, null, 2)
      }]
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Your Tool Error: ${err.response?.data?.message || err.message}`
      }]
    };
  }
}
```

### Best Practices for Tool Handlers

- Always return `{ hint: '...' }` to guide the AI agent on next steps
- Use `isError: true` for failures (never throw inside handlers)
- Include contextual error tips based on HTTP status codes
- Return `before/after` diffs for mutation operations (see `patch_workflow_node`)
- Use cursor-based pagination for list endpoints that might exceed 100 items

## 📐 Conventions

### Commit Messages

[Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation update
- `refactor:` — Code restructure
- `chore:` — Maintenance (CI, dependencies)

### Code Style

- TypeScript with `any` where needed (MCP args are dynamic)
- Complete error handling — always return `isError: true`, never throw
- All tool descriptions should be written for AI agent consumption

## 💡 Contribution Ideas

- [ ] **Deep merge** for `patch_workflow_node` (currently shallow merge for nested params)
- [ ] **Webhook callback** pattern for workflows >10 minutes
- [ ] **Unit tests** for each tool handler
- [ ] **SSE transport** support
- [ ] **Rate limiting** to prevent API abuse
- [ ] **Authentication layer** for MCP endpoint
- [ ] **Workflow diff** tool — compare two workflow versions
- [ ] **Bulk operations** — activate/deactivate multiple workflows

## ❓ Questions?

Open an [Issue](https://github.com/duyasia/n8n-custom-mcp/issues) on GitHub.

---

Thank you for making this project better! 🙏
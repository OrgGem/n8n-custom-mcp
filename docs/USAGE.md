# 📖 Advanced Usage Guide

## Table of Contents

- [The Self-Healing Deploy Loop](#the-self-healing-deploy-loop)
- [Common Scenarios](#common-scenarios)
- [Tips & Tricks](#tips--tricks)
- [System Prompt Template](#system-prompt-template)

---

## The Self-Healing Deploy Loop

The most powerful pattern enabled by n8n-custom-mcp. An AI agent autonomously builds, tests, and fixes workflows:

### Scenario: "Build a Slack notification workflow from a template"

```
AI Agent automatically:
  1. search_templates("slack notification")    → Find community template
  2. import_template(templateId: 1234)         → Deploy as workflow
  3. list_credentials(type: "slackApi")        → Find existing Slack creds
  4. clone_credentials(source: "42", target: "new-id")  → Auto-assign
  5. validate_workflow(...)                     → Pre-deploy check
  6. execute_workflow_and_wait(id: "new-id")   → Run + wait for result
  7. FAILED → get_execution_data(errorsOnly: true)
     → "Slack channel not found"
  8. patch_workflow_node(nodeName: "Slack", parameters: {channel: "#general"})
  9. execute_workflow_and_wait(id: "new-id")   → Verify fix
  10. SUCCESS ✅
```

**Key insight**: Steps 7-9 happen autonomously. The agent reads the error, understands it, fixes the specific node, and re-tests — all without human intervention.

---

## Common Scenarios

### Scenario 1: Debug a failing workflow

```
User: "Workflow ID 42 keeps failing, find and fix the issue"

AI Agent:
  1. get_workflow_summary(id: "42")
     → Quick overview: 8 nodes, trigger=schedule, uses Google Sheets + HTTP Request
  2. get_execution_data(id: latest, errorsOnly: true)
     → "HTTP Request" node: 401 Unauthorized, httpCode: 401
  3. list_credentials(type: "httpHeader")
     → Found: id="15", name="API Token (expired)"
  4. update_credential(id: "15", type: "httpHeaderAuth", data: {value: "Bearer new-token"})
  5. execute_workflow_and_wait(id: "42")
     → SUCCESS ✅
```

### Scenario 2: Clone a workflow for another environment

```
User: "Duplicate the production email workflow for staging with different credentials"

AI Agent:
  1. duplicate_workflow(id: "50", name: "Email Workflow (Staging)")
     → New workflow ID: "75"
  2. list_credentials(type: "smtp")
     → Found staging SMTP: id="20"
  3. patch_workflow_node(workflowId: "75", nodeName: "Send Email",
       credentials: {smtpAccount: {id: "20", name: "Staging SMTP"}})
  4. execute_workflow_and_wait(id: "75")
     → SUCCESS ✅
```

### Scenario 3: Build from scratch with schema discovery

```
User: "Create a workflow that checks Haravan orders every hour"

AI Agent:
  1. get_node_schema(nodeType: "n8n-nodes-base.scheduleTrigger")
     → Knows exact parameter structure for cron
  2. get_node_schema(nodeType: "n8n-nodes-base.httpRequest")
     → Knows how to configure HTTP Request
  3. list_credentials(type: "httpHeader")
     → Found Haravan API key
  4. validate_workflow(nodes: [...], connections: {...})
     → All checks passed
  5. create_workflow(name: "Haravan Order Check", nodes: [...])
  6. execute_workflow_and_wait(id: "new-id")
     → Verify it works
```

### Scenario 4: Diagnose before execute (NEW v2.5.0)

```
User: "Deploy and test this social media monitoring workflow"

AI Agent:
  1. get_node_versions("n8n-nodes-base.httpRequest")
     → recommendedVersion: 4.2
  2. get_node_versions("n8n-nodes-base.code")
     → recommendedVersion: 2
  3. create_workflow(name: "Social Monitor", nodes: [...])  // uses correct versions
  4. diagnose_workflow(workflowId)
     → CRITICAL: Code node "Parser" uses fetch() — BLOCKED in sandbox
     → WARNING: Node "HTTP Request" using typeVersion 2, but 4.2 available
  5. patch_workflow_node(nodeName: "Parser", parameters: {jsCode: "...fixed..."})
  6. diagnose_workflow(workflowId)  // re-check
     → Healthy! 0 critical, 0 errors
  7. execute_workflow_and_wait(workflowId)
     → SUCCESS ✅
```

**Key insight**: `diagnose_workflow` catches sandbox violations and version mismatches BEFORE execution — saving 3-5 debug iterations.

---

## Tips & Tricks

### 1. Always use `errorsOnly` for debugging

```json
{
  "id": "execution-id",
  "errorsOnly": true
}
```

This filters to only failed nodes — much faster than reading through 20+ node outputs.

### 2. Use `patch_workflow_node` instead of `update_workflow`

`update_workflow` replaces the **entire** workflow JSON → risk of corruption.
`patch_workflow_node` updates **one node** → safe, with before/after verification.

### 3. Use progressive timeout for long workflows

```json
{
  "id": "workflow-id",
  "timeoutSeconds": 300
}
```

Default is 120s (2 min). Max is 600s (10 min). For workflows that process hundreds of items, increase the timeout.

### 4. Use `get_workflow_summary` before editing

Instead of parsing raw JSON from `get_workflow`, use `get_workflow_summary` to quickly understand:
- What nodes exist and their types
- Connection flow (A → B → C)
- What credential types are needed
- Whether the workflow has a trigger

### 5. Combine `import_template` + `clone_credentials`

When deploying a template that needs the same credentials as an existing workflow:

```
import_template(templateId: 1234)  → Creates workflow
clone_credentials(source: "existing-wf", target: "new-wf")  → Auto-assigns creds
```

This saves 5-10 individual `patch_workflow_node` calls.

### 6. Always check node versions before creating workflows

```json
// BEFORE creating a node, check its latest version:
get_node_versions("n8n-nodes-base.httpRequest")
// → { recommendedVersion: 4.2 }

// Then use that version:
{ "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, ... }
```

Using an outdated `typeVersion` causes invisible errors: wrong parameter schemas, missing features, or silent failures.

### 7. Use `diagnose_workflow` instead of `validate_workflow`

`validate_workflow` only checks structural JSON correctness (local check).
`diagnose_workflow` checks the LIVE state on n8n: credentials exist, sandbox compatibility, version correctness.

**Always use `diagnose_workflow` after deploying, before executing.**

### 8. Clean up zombie executions

If a workflow stops producing new executions, there may be stuck ones blocking it:

```
list_executions(workflowId: "...", limit: 5)
// Find any with finished: false
delete_execution(ids: ["stuck-id-1", "stuck-id-2"])
execute_workflow_and_wait(workflowId)  // Works again!
```

---

## System Prompt Template

Add this to your AI agent's system prompt for optimal n8n-custom-mcp usage:

```markdown
# n8n Workflow Automation Expert

You have access to 36 MCP tools for managing n8n workflows. Follow these rules:

## Workflow Creation
1. Use `get_node_versions` to get the latest typeVersion — NEVER hardcode versions
2. Use `get_node_schema` to learn correct parameters before creating nodes
3. Always `diagnose_workflow` after deploying, before executing
4. Use `import_template` when a community template exists for the use case

## Debugging
1. Start with `get_workflow_summary` to understand the workflow structure
2. Use `get_execution_data(errorsOnly: true)` for quick root cause analysis
3. Fix with `patch_workflow_node` (never use `update_workflow` for single-node fixes)
4. Always re-execute to verify the fix

## Credentials
1. Check `list_credentials` before creating new ones (avoid duplicates)
2. Use `clone_credentials` when deploying workflows that share credential types
3. Use `update_credential` to rotate tokens without breaking workflow references

## Safety
- Always use `duplicate_workflow` before making risky changes
- Never `activate_workflow` until verified via `execute_workflow_and_wait`
- Use `tag_workflow` to categorize (Production, Draft, Testing)

## Webhook Data Access
- Data is always under `$json.body` for webhook triggers
- ✅ `{{ $json.body.email }}`
- ❌ `{{ $json.email }}`

## Code Node Return Format
- Must return: `[{json: {key: "value"}}]`
```
# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.4.0] - 2025-03-25

### Added
- **`import_template`** — One-step template import: fetch from n8n.io → create workflow
- **`get_workflow_summary`** — Human-readable workflow overview (nodes, connections, credential types)
- **`clone_credentials`** — Copy credential assignments between workflows by node type matching
- `n8nInternal` axios client for n8n internal API access (bypasses `/api/v1`)

### Changed
- `execute_workflow_and_wait`: Increased max timeout from 120s to **600s** (10 minutes)
- `execute_workflow_and_wait`: Default timeout changed from 60s to **120s**
- `execute_workflow_and_wait`: Added **progressive backoff** polling (2s→4s→8s→10s cap)
- `get_node_schema`: Now uses POST `/rest/node-types` via internal client instead of GET `/api/v1/node-types`

### Fixed
- **Race condition** in `execute_workflow_and_wait` — now records pre-execution ID to avoid picking old executions
- **`tag_workflow`** — Now strips `id`/`versionId` before PUT (consistent with other handlers)
- **`list_credentials`** — Added cursor-based pagination (previously capped at 100)
- **`trigger_webhook`** — HTTP status ≥ 400 now correctly returns `isError: true`
- Removed unused `execResponse` variable in `execute_workflow_and_wait`

### Removed
- Unused `zod` dependency (import and package.json)

## [2.3.0] - 2025-03-25

### Added
- **`get_node_schema`** — Query n8n internal API for complete node parameter schemas
- **`execute_workflow_and_wait`** — Execute + auto-poll until complete, return results in one step
- Enhanced `get_execution_data`:
  - `errorsOnly` filter for quick root cause analysis
  - Stack traces (up to 800 chars)
  - HTTP status codes from failed API calls
  - `context` and `cause` error fields
  - `nodeType` information on errors
  - Item-level error extraction

## [2.2.0] - 2025-03-25

### Added
- **`list_credentials`** — List all credentials with type filtering
- **`update_credential`** — Update credential data without breaking workflow references
- **`patch_workflow_node`** — Surgically update a single node (params, credentials, disabled state) with before/after diff
- **`validate_workflow`** — Pre-deploy structural validation (missing fields, duplicates, orphaned connections, trigger check)

## [2.1.0] - 2025-03-20

### Added
- Community template tools: `search_templates`, `get_template`
- Credential management: `get_credential_schema`, `create_credential`, `delete_credential`
- Node discovery: `get_node_type_details`, `list_node_types`
- Tag management: `list_tags`, `create_tag`, `update_tag`, `delete_tag`, `tag_workflow`
- Workflow duplication: `duplicate_workflow`
- Runner Workflow Pattern for remote execution via webhook bridge

## [1.0.0] - 2025-03-15

### Added
- Initial release with 12 tools
- Workflow CRUD: `list_workflows`, `get_workflow`, `create_workflow`, `update_workflow`, `delete_workflow`, `activate_workflow`
- Execution: `execute_workflow`, `trigger_webhook`
- Monitoring: `list_executions`, `get_execution`, `get_execution_data`
- Docker multi-stage build with supergateway

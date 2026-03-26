#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const N8N_HOST = process.env.N8N_HOST || 'http://localhost:5678';
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_API_KEY) {
  console.error("Error: N8N_API_KEY environment variable is required");
  process.exit(1);
}

const n8n = axios.create({
  baseURL: `${N8N_HOST}/api/v1`,
  headers: {
    'X-N8N-API-KEY': N8N_API_KEY,
  },
});

const webhookClient = axios.create({
  baseURL: N8N_HOST,
  headers: {
    'Content-Type': 'application/json',
  },
});

// n8n Community Templates API (public, no auth required)
const n8nTemplates = axios.create({
  baseURL: 'https://api.n8n.io/api/templates',
  headers: {
    'Content-Type': 'application/json',
  },
});

// n8n Internal API client (same host, no /api/v1 prefix — for node-types endpoint)
const n8nInternal = axios.create({
  baseURL: N8N_HOST,
  headers: {
    'X-N8N-API-KEY': N8N_API_KEY,
    'Content-Type': 'application/json',
  },
});

const server = new Server(
  {
    name: 'n8n-custom-mcp',
    version: '2.5.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      /* WORKFLOW MANAGEMENT */
      {
        name: 'list_workflows',
        description: 'List all workflows in n8n',
        inputSchema: {
          type: 'object',
          properties: {
            active: { type: 'boolean', description: 'Filter by active status' },
            limit: { type: 'number', description: 'Limit number of results' },
            tags: { type: 'string', description: 'Filter by tags (comma separated)' },
          },
        },
      },
      {
        name: 'get_workflow',
        description: 'Get detailed information about a workflow (nodes, connections, settings)',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The workflow ID' },
          },
          required: ['id'],
        },
      },
      {
        name: 'create_workflow',
        description: 'Create a new workflow',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the workflow' },
            nodes: { type: 'array', description: 'Array of node objects' },
            connections: { type: 'object', description: 'Object defining connections' },
            active: { type: 'boolean', description: 'Whether active' },
            settings: { type: 'object', description: 'Workflow settings' },
          },
          required: ['name'],
        },
      },
      {
        name: 'update_workflow',
        description: 'Update an existing workflow',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID' },
            name: { type: 'string' },
            nodes: { type: 'array' },
            connections: { type: 'object' },
            active: { type: 'boolean' },
            settings: { type: 'object' },
          },
          required: ['id'],
        },
      },
      {
        name: 'delete_workflow',
        description: 'Delete a workflow',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID' },
          },
          required: ['id'],
        },
      },
      {
        name: 'activate_workflow',
        description: 'Activate or deactivate a workflow',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID' },
            active: { type: 'boolean', description: 'True to activate' },
          },
          required: ['id', 'active'],
        },
      },
      {
        name: 'duplicate_workflow',
        description: 'Duplicate (clone) an existing workflow. Creates a copy with all nodes, connections, and settings. The clone is created inactive by default. Useful for creating variations of existing workflows.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Source workflow ID to duplicate' },
            name: { type: 'string', description: 'Name for the new workflow (default: original name + " (Copy)")' },
          },
          required: ['id'],
        },
      },

      /* EXECUTION & TESTING */
      {
        name: 'execute_workflow',
        description: 'Manually trigger a workflow execution using n8n\'s internal API (same as clicking "Test Workflow" in the editor). Works with any workflow — no Runner Workflow needed. Returns execution data directly.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID' },
            inputData: { type: 'object', description: 'Optional input data to pass to the workflow trigger node' },
          },
          required: ['id'],
        },
      },
      {
        name: 'trigger_webhook',
        description: 'Trigger a webhook endpoint for testing',
        inputSchema: {
          type: 'object',
          properties: {
            webhook_path: { type: 'string', description: 'Webhook path/UUID' },
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'POST' },
            body: { type: 'object', description: 'JSON body payload' },
            test_mode: { type: 'boolean', description: 'Use /webhook-test/ endpoint if true' },
          },
          required: ['webhook_path'],
        },
      },
      {
        name: 'execute_workflow_and_wait',
        description: 'Execute a workflow and wait for it to complete, then return the execution result. Uses n8n\'s internal API directly — no Runner Workflow needed. Polls execution status until done (success or error). Max wait: 600 seconds (10 minutes). Uses progressive backoff polling.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID to execute' },
            inputData: { type: 'object', description: 'Optional input data for the workflow trigger' },
            timeoutSeconds: { type: 'number', description: 'Max seconds to wait for completion (default: 120, max: 600)', default: 120 },
            maxItems: { type: 'number', description: 'Max output items per node in results (default: 3)', default: 3 },
          },
          required: ['id'],
        },
      },

      /* DEBUGGING & MONITORING (NEW) */
      {
        name: 'list_executions',
        description: 'List recent workflow executions to check status',
        inputSchema: {
          type: 'object',
          properties: {
            includeData: { type: 'boolean', description: 'Include execution data' },
            status: { type: 'string', enum: ['error', 'success', 'waiting'] },
            limit: { type: 'number', default: 20 },
            workflowId: { type: 'string', description: 'Filter by workflow ID' },
          },
        },
      },
      {
        name: 'get_execution',
        description: 'Get full details of a specific execution for debugging',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Execution ID' },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_execution_data',
        description: 'Get detailed per-node execution data for debugging. Shows what data each node received and produced, execution status, timing, errors with stack traces and context. Essential for identifying which node failed and why.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Execution ID' },
            nodeName: { type: 'string', description: 'Optional: filter to a specific node name to see only its data' },
            maxItems: { type: 'number', description: 'Max output items to return per node (default: 3, use higher for debugging specific data)', default: 3 },
            errorsOnly: { type: 'boolean', description: 'If true, only return nodes that failed (useful for quick root cause analysis)', default: false },
          },
          required: ['id'],
        },
      },
      {
        name: 'list_node_types',
        description: 'List all node types used across your n8n workflows. Returns unique node types with usage count and which workflows use them. Useful for discovering what integrations are available.',
        inputSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Optional: filter node types by name (e.g. "http", "gmail", "slack")' },
          },
        },
      },

      /* COMMUNITY TEMPLATES */
      {
        name: 'search_templates',
        description: 'Search n8n community workflow templates from n8n.io. Returns template ID, name, description, nodes used, and view count. Use get_template to fetch the full workflow JSON for import.',
        inputSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Search keyword (e.g. "webhook", "slack", "email automation")' },
            category: { type: 'string', description: 'Filter by category (e.g. "marketing", "sales", "engineering", "it-ops")' },
            rows: { type: 'number', description: 'Number of results to return (default: 10, max: 50)', default: 10 },
            page: { type: 'number', description: 'Page number for pagination (default: 1)', default: 1 },
          },
          required: ['search'],
        },
      },
      {
        name: 'get_template',
        description: 'Get full details of an n8n community template by ID, including the complete workflow JSON (nodes, connections) that can be used directly with create_workflow to import it.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Template ID from search_templates results' },
          },
          required: ['id'],
        },
      },

      /* CREDENTIALS MANAGEMENT */
      {
        name: 'get_credential_schema',
        description: 'Get credential type info by scanning your workflows for real usage examples. Shows which nodes use the credential type, how they are configured, and which workflows reference them. Use this before create_credential to understand credential types.',
        inputSchema: {
          type: 'object',
          properties: {
            credentialTypeName: { type: 'string', description: 'The credential type name to search for (e.g. "httpBasicAuth", "oAuth2Api", "gmail"). Supports partial match.' },
          },
          required: ['credentialTypeName'],
        },
      },
      {
        name: 'create_credential',
        description: 'Create a new credential in n8n. Use get_credential_schema first to know what fields are required for the credential type.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display name for the credential (e.g. "My Gmail Account")' },
            type: { type: 'string', description: 'Credential type name (e.g. "httpBasicAuth", "gmailOAuth2Api")' },
            data: { type: 'object', description: 'Credential data fields as defined by the schema (e.g. { "user": "admin", "password": "secret" })' },
          },
          required: ['name', 'type', 'data'],
        },
      },
      {
        name: 'delete_credential',
        description: 'Delete a credential by its ID. Warning: workflows using this credential will break.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Credential ID to delete' },
          },
          required: ['id'],
        },
      },

      /* NODE TYPE DETAILS */
      {
        name: 'get_node_type_details',
        description: 'Get detailed information about a specific n8n node type by scanning existing workflows for real usage examples. Returns all unique parameter configurations, credential references, typeVersions, and the documentation URL. Use the full type name like "n8n-nodes-base.webhook" or a partial name like "webhook" for fuzzy search.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeType: { type: 'string', description: 'Node type name (full: "n8n-nodes-base.webhook", or partial: "webhook", "httpRequest", "gmail")' },
          },
          required: ['nodeType'],
        },
      },
      {
        name: 'get_node_schema',
        description: 'Get the official parameter schema for an n8n node type from the n8n instance internal API. Unlike get_node_type_details (which scans existing workflows), this returns the complete parameter definition including all available options, defaults, and descriptions. Works for ANY node type, even ones never used in your workflows. Requires n8n to be accessible from the MCP server.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeType: { type: 'string', description: 'Full node type name (e.g. "n8n-nodes-base.httpRequest", "n8n-nodes-base.googleSheets")' },
            version: { type: 'number', description: 'Optional: specific typeVersion to get schema for (default: latest)' },
          },
          required: ['nodeType'],
        },
      },

      /* TAG MANAGEMENT */
      {
        name: 'list_tags',
        description: 'List all tags in the n8n instance. Tags are used to organize and categorize workflows.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'create_tag',
        description: 'Create a new tag for organizing workflows.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tag name (e.g. "marketing", "production", "testing")' },
          },
          required: ['name'],
        },
      },
      {
        name: 'update_tag',
        description: 'Rename an existing tag.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Tag ID' },
            name: { type: 'string', description: 'New tag name' },
          },
          required: ['id', 'name'],
        },
      },
      {
        name: 'delete_tag',
        description: 'Delete a tag. This will remove the tag from all workflows that use it.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Tag ID to delete' },
          },
          required: ['id'],
        },
      },
      {
        name: 'tag_workflow',
        description: 'Assign tags to a workflow. Provide the full list of tag IDs — this replaces all existing tags on the workflow. Use list_tags first to get tag IDs.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'Workflow ID to tag' },
            tagIds: { type: 'array', items: { type: 'string' }, description: 'Array of tag IDs to assign (replaces existing tags)' },
          },
          required: ['workflowId', 'tagIds'],
        },
      },

      /* CREDENTIALS DISCOVERY (NEW v2.2.0) */
      {
        name: 'list_credentials',
        description: 'List all credentials in n8n. Returns ID, name, type, and creation date for each credential. Essential for discovering existing credentials to reuse in workflows instead of creating duplicates.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Optional: filter by credential type name (e.g. "httpHeaderAuth", "oAuth2Api")' },
          },
        },
      },
      {
        name: 'update_credential',
        description: 'Update an existing credential\'s name or data fields without deleting it. This preserves all workflow references to the credential. Use list_credentials to find the credential ID first.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Credential ID to update' },
            name: { type: 'string', description: 'New display name for the credential' },
            type: { type: 'string', description: 'Credential type (required by n8n API, e.g. "httpHeaderAuth")' },
            data: { type: 'object', description: 'Updated credential data fields (e.g. { "value": "Bearer new-token" })' },
          },
          required: ['id', 'type'],
        },
      },

      /* SURGICAL WORKFLOW EDITING (NEW v2.2.0) */
      {
        name: 'patch_workflow_node',
        description: 'Surgically update a single node in a workflow without touching the rest of the workflow JSON. Safely merges parameters, updates credentials, or toggles disabled state. Much safer than update_workflow for single-node fixes. Returns the node before and after patching for verification.',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'Workflow ID containing the node' },
            nodeName: { type: 'string', description: 'Exact name of the node to patch (e.g. "HTTP Request", "Google Sheets")' },
            parameters: { type: 'object', description: 'Parameters to merge into the node (shallow merge — only specified keys are updated, others preserved)' },
            credentials: { type: 'object', description: 'Credentials to set on the node (e.g. { "googleSheetsOAuth2Api": { "id": "123", "name": "My Sheets" } })' },
            disabled: { type: 'boolean', description: 'Set to true to disable the node, false to enable it' },
          },
          required: ['workflowId', 'nodeName'],
        },
      },
      {
        name: 'validate_workflow',
        description: 'Validate a workflow structure before deploying it. Checks for common issues: missing node names/types, duplicate node names, orphaned connections, missing trigger nodes. Use this before create_workflow or update_workflow to prevent corruption.',
        inputSchema: {
          type: 'object',
          properties: {
            nodes: { type: 'array', description: 'Array of node objects to validate' },
            connections: { type: 'object', description: 'Connections object to validate against nodes' },
          },
          required: ['nodes'],
        },
      },

      /* PRODUCTIVITY TOOLS (NEW v2.4.0) */
      {
        name: 'import_template',
        description: 'Import an n8n community template directly as a new workflow. Fetches the template by ID from n8n.io, creates a workflow from it, and returns the new workflow ID. Combines search_templates + get_template + create_workflow into one step.',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: { type: 'number', description: 'Template ID from search_templates results' },
            name: { type: 'string', description: 'Optional: custom name for the imported workflow (default: template name)' },
            activate: { type: 'boolean', description: 'Whether to activate the workflow after import (default: false)', default: false },
          },
          required: ['templateId'],
        },
      },
      {
        name: 'get_workflow_summary',
        description: 'Get a concise human-readable summary of a workflow structure. Returns node names with types, connection flow, trigger type, credential types used, and settings. Much easier to understand than raw get_workflow JSON. Use this to quickly understand what a workflow does before editing it.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID to summarize' },
          },
          required: ['id'],
        },
      },
      {
        name: 'clone_credentials',
        description: 'Copy credential assignments from a source workflow to a target workflow. Matches credentials by node type — for each node in the target that shares the same type as a node in the source, copies the credential reference. Useful when deploying a new workflow that needs the same credentials as an existing one.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceWorkflowId: { type: 'string', description: 'Source workflow ID to copy credentials FROM' },
            targetWorkflowId: { type: 'string', description: 'Target workflow ID to apply credentials TO' },
          },
          required: ['sourceWorkflowId', 'targetWorkflowId'],
        },
      },

      /* EXECUTION MANAGEMENT (NEW v2.5.0) */
      {
        name: 'delete_execution',
        description: 'Delete one or more workflow executions by ID. Essential for cleaning up stuck/zombie executions (finished: false) that block new executions from running. Supports single or bulk deletion.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Single execution ID to delete' },
            ids: { type: 'array', items: { type: 'string' }, description: 'Array of execution IDs to delete in bulk (alternative to single id)' },
          },
        },
      },

      /* NODE VERSION DISCOVERY (NEW v2.5.0) */
      {
        name: 'get_node_versions',
        description: 'Get all available typeVersions for a node type from the n8n instance. Returns the latest version number, all available versions, and default parameters for the latest version. ALWAYS use this before creating workflows to ensure you use the correct typeVersion — using an outdated version causes invisible runtime errors.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeType: { type: 'string', description: 'Full node type name (e.g. "n8n-nodes-base.httpRequest", "n8n-nodes-base.code", "n8n-nodes-base.googleSheets")' },
          },
          required: ['nodeType'],
        },
      },

      /* DEEP WORKFLOW DIAGNOSIS (NEW v2.5.0) */
      {
        name: 'diagnose_workflow',
        description: 'Deep diagnosis of a deployed workflow. Goes beyond validate_workflow by checking the LIVE state on the n8n instance: (1) structural validation, (2) credential existence check, (3) node typeVersion correctness vs latest available, (4) Code node sandbox compatibility warnings (fetch/$helpers usage), (5) connection integrity (orphan nodes, unreachable paths), (6) latest execution status. Use this BEFORE execute_workflow to catch issues early.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Workflow ID to diagnose' },
          },
          required: ['id'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    // --- WORKFLOW CRUD ---
    if (name === 'list_workflows') {
      try {
        const { active, limit, tags } = args as any;
        const response = await n8n.get('/workflows', { params: { active, limit, tags } });
        const workflows = (response.data.data || []).map((w: any) => ({
          id: w.id, name: w.name, active: w.active,
          tags: w.tags?.map((t: any) => t.name),
          createdAt: w.createdAt, updatedAt: w.updatedAt,
        }));
        return { content: [{ type: 'text', text: JSON.stringify({ total: workflows.length, workflows }, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `List Workflows Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'get_workflow') {
      try {
        const { id } = args as any;
        const response = await n8n.get(`/workflows/${id}`);
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Get Workflow Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'create_workflow') {
      try {
        const response = await n8n.post('/workflows', args);
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Create Workflow Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'update_workflow') {
      try {
        const { id, ...data } = args as any;
        // n8n API requires 'name' in PUT body — auto-fetch if not provided
        if (!data.name) {
          const current = await n8n.get(`/workflows/${id}`);
          data.name = current.data.name;
        }
        const response = await n8n.put(`/workflows/${id}`, data);
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Update Workflow Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'delete_workflow') {
      try {
        const { id } = args as any;
        await n8n.delete(`/workflows/${id}`);
        return { content: [{ type: 'text', text: `Successfully deleted workflow ${id}` }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Delete Workflow Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'duplicate_workflow') {
      const { id, name: newName } = args as any;
      try {
        // Fetch original workflow
        const original = await n8n.get(`/workflows/${id}`);
        const wf = original.data;

        // Create clone: keep nodes, connections, settings; strip metadata
        const clone = {
          name: newName || `${wf.name} (Copy)`,
          nodes: wf.nodes,
          connections: wf.connections,
          settings: wf.settings,
          staticData: wf.staticData,
          active: false,
        };

        const created = await n8n.post('/workflows', clone);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              original: { id: wf.id, name: wf.name },
              duplicate: { id: created.data.id, name: created.data.name },
              hint: 'The duplicate is inactive. Use activate_workflow to enable it after making changes.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Duplicate Workflow Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'activate_workflow') {
      try {
        const { id, active } = args as any;
        const response = await n8n.post(`/workflows/${id}/${active ? 'activate' : 'deactivate'}`);
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Activate Workflow Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    // --- EXECUTION ---
    if (name === 'execute_workflow') {
      const { id, inputData } = args as any;
      try {
        // Fetch the full workflow definition
        const wfResponse = await n8n.get(`/workflows/${id}`);
        const wf = wfResponse.data;

        // Find the trigger/start node
        const startNode = wf.nodes?.find((n: any) =>
          (n.type || '').toLowerCase().includes('trigger') ||
          (n.type || '').toLowerCase().includes('webhook')
        ) || wf.nodes?.[0];

        // Build the execution payload (same format as n8n Editor UI)
        const runPayload: any = {
          workflowData: {
            ...wf,
            id: wf.id,
          },
          startNodes: startNode ? [{ name: startNode.name, sourceData: null }] : [],
          runData: {},
        };

        // If inputData provided, inject it as manual trigger data
        if (inputData && startNode) {
          runPayload.runData[startNode.name] = [{
            startTime: Date.now(),
            executionTime: 0,
            executionStatus: 'success',
            data: { main: [[{ json: inputData }]] },
            source: [null],
          }];
        }

        const response = await n8nInternal.post('/rest/workflows/run', runPayload);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              workflowId: id,
              executionId: response.data?.data?.executionId || response.data?.executionId || null,
              result: response.data,
              hint: 'Use get_execution_data to inspect the execution details.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        const status = err.response?.status;
        const msg = err.response?.data?.message || err.message;
        let hint = '';
        if (status === 401 || status === 403) hint = ' The internal API may require cookie-based auth. Try running MCP server in the same Docker network as n8n.';
        if (status === 500) hint = ' The target workflow may have errors. Use get_execution_data to debug.';
        return { isError: true, content: [{ type: 'text', text: `Execute Workflow Error: ${msg}${hint}` }] };
      }
    }

    if (name === 'trigger_webhook') {
      const { webhook_path, method = 'POST', body, test_mode } = args as any;
      const endpoint = test_mode ? '/webhook-test/' : '/webhook/';
      const url = `${endpoint}${webhook_path}`;
      
      try {
        const response = await webhookClient.request({
          method,
          url,
          data: body,
          validateStatus: () => true,
        });
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: response.status,
              statusText: response.statusText,
              data: response.data,
              url: `${N8N_HOST}${url}`
            }, null, 2)
          }],
          isError: response.status >= 400,
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Webhook Error: ${err.message}` }] };
      }
    }

    // --- EXECUTE AND WAIT (NEW v2.3.0) ---
    if (name === 'execute_workflow_and_wait') {
      const { id, inputData, timeoutSeconds = 120, maxItems = 3 } = args as any;
      const timeout = Math.min(timeoutSeconds, 600); // Max 10 minutes

      try {
        // Step 0: Record pre-execution state to avoid race condition with old executions
        const preExecList = await n8n.get('/executions', {
          params: { workflowId: id, limit: 1 },
        });
        const lastExecId = preExecList.data?.data?.[0]?.id || null;

        // Step 1: Fetch workflow definition and execute via internal API
        const wfResponse = await n8n.get(`/workflows/${id}`);
        const wf = wfResponse.data;

        const startNode = wf.nodes?.find((n: any) =>
          (n.type || '').toLowerCase().includes('trigger') ||
          (n.type || '').toLowerCase().includes('webhook')
        ) || wf.nodes?.[0];

        const runPayload: any = {
          workflowData: { ...wf, id: wf.id },
          startNodes: startNode ? [{ name: startNode.name, sourceData: null }] : [],
          runData: {},
        };

        if (inputData && startNode) {
          runPayload.runData[startNode.name] = [{
            startTime: Date.now(),
            executionTime: 0,
            executionStatus: 'success',
            data: { main: [[{ json: inputData }]] },
            source: [null],
          }];
        }

        await n8nInternal.post('/rest/workflows/run', runPayload);

        // Step 2: Poll with progressive backoff (2s → 4s → 8s → 10s cap)
        const backoffIntervals = [2000, 2000, 4000, 4000, 8000]; // first 5 polls
        const maxInterval = 10000; // cap at 10s for long-running workflows
        let executionId: string | null = null;
        let finalExecution: any = null;

        let elapsedMs = 0;
        for (let attempt = 0; elapsedMs < timeout * 1000; attempt++) {
          const interval = attempt < backoffIntervals.length ? backoffIntervals[attempt] : maxInterval;
          await new Promise(resolve => setTimeout(resolve, interval));
          elapsedMs += interval;

          // Find the latest execution for this workflow
          const execList = await n8n.get('/executions', {
            params: { workflowId: id, limit: 1 },
          });
          const latestExec = execList.data?.data?.[0];

          if (latestExec && latestExec.id !== lastExecId) {
            executionId = latestExec.id;

            if (latestExec.status === 'success' || latestExec.status === 'error' || latestExec.status === 'crashed') {
              // Execution finished - get full data
              const fullExec = await n8n.get(`/executions/${executionId}`, { params: { includeData: true } });
              finalExecution = fullExec.data;
              break;
            }
          }
        }

        if (!finalExecution) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                workflowId: id,
                executionId,
                error: `Execution did not complete within ${timeout} seconds.`,
                hint: executionId
                  ? `Use get_execution_data with id "${executionId}" to check status later.`
                  : 'No execution was found. The workflow may not have started. Check if the Runner workflow is active.',
              }, null, 2)
            }]
          };
        }

        // Step 3: Process results
        const runData = finalExecution.data?.resultData?.runData || {};
        const lastError = finalExecution.data?.resultData?.error;
        const nodeNames = Object.keys(runData);

        const nodeSummaries = nodeNames.map((nName: string) => {
          const runs = runData[nName];
          return runs.map((run: any, idx: number) => {
            const outputData = run.data?.main?.[0] || [];
            const itemCount = outputData.length;
            const sampleItems = outputData.slice(0, maxItems).map((item: any) => item.json);

            let errorDetails: any = null;
            if (run.error) {
              errorDetails = {
                message: run.error.message || 'Unknown error',
                description: run.error.description || null,
                httpCode: run.error.httpCode || run.error.statusCode || null,
              };
            }

            return {
              nodeName: nName,
              runIndex: idx,
              executionStatus: run.executionStatus,
              executionTime: run.executionTime,
              itemCount,
              error: errorDetails,
              outputSample: sampleItems,
            };
          });
        }).flat();

        const failedNodes = nodeSummaries.filter((n: any) => n.error);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: finalExecution.status === 'success',
              workflowId: id,
              executionId,
              status: finalExecution.status,
              startedAt: finalExecution.startedAt,
              stoppedAt: finalExecution.stoppedAt,
              totalNodes: nodeNames.length,
              failedNodeCount: failedNodes.length,
              ...(failedNodes.length > 0 ? {
                errorSummary: failedNodes.map((n: any) => `${n.nodeName}: ${n.error?.message}`).join(' | '),
              } : {}),
              ...(lastError ? { workflowError: { message: lastError.message, description: lastError.description } } : {}),
              nodes: nodeSummaries,
              hint: finalExecution.status === 'success'
                ? 'Workflow completed successfully! Review node outputs above.'
                : 'Workflow failed. Check errorSummary and failed nodes above. Use patch_workflow_node to fix, then execute again.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        const status = err.response?.status;
        const msg = err.response?.data?.message || err.message;
        let hint = '';
        if (status === 404) hint = ' The runner workflow may not be active. Check [MCP] Workflow Runner in n8n.';
        if (status === 401 || status === 403) hint = ' The internal API may require cookie-based auth. Ensure MCP server is in the same Docker network.';
        return { isError: true, content: [{ type: 'text', text: `Execute & Wait Error: ${msg}${hint}` }] };
      }
    }

    // --- MONITORING ---
    if (name === 'list_executions') {
      try {
        const response = await n8n.get('/executions', { params: args });
        return { content: [{ type: 'text', text: JSON.stringify(response.data.data, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `List Executions Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'get_execution') {
      try {
        const { id } = args as any;
        const response = await n8n.get(`/executions/${id}`);
        return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Get Execution Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'get_execution_data') {
      const { id, nodeName, maxItems = 3, errorsOnly = false } = args as any;
      try {
        const response = await n8n.get(`/executions/${id}`, { params: { includeData: true } });
        const exec = response.data;
        const runData = exec.data?.resultData?.runData;
        const lastError = exec.data?.resultData?.error;

        if (!runData) {
          return { content: [{ type: 'text', text: JSON.stringify({
            error: 'No execution data available. The execution may have been pruned or is still running.',
            executionId: id,
            status: exec.status,
            ...(lastError ? { workflowError: { message: lastError.message, description: lastError.description, stack: lastError.stack?.substring(0, 500) } } : {}),
          }, null, 2) }] };
        }

        const nodeNames = Object.keys(runData);
        let filteredNames = nodeName
          ? nodeNames.filter(n => n.toLowerCase().includes(nodeName.toLowerCase()))
          : nodeNames;

        // If errorsOnly, filter to only nodes with errors
        if (errorsOnly) {
          filteredNames = filteredNames.filter(nName => {
            const runs = runData[nName];
            return runs.some((run: any) => run.error || run.executionStatus === 'error');
          });
        }

        const nodeSummaries = filteredNames.map(nName => {
          const runs = runData[nName];
          return runs.map((run: any, idx: number) => {
            const outputData = run.data?.main?.[0] || [];
            const itemCount = outputData.length;
            const sampleItems = outputData.slice(0, maxItems).map((item: any) => item.json);

            // Enhanced error extraction (v2.3.0)
            let errorDetails: any = null;
            if (run.error) {
              errorDetails = {
                message: run.error.message || 'Unknown error',
                description: run.error.description || null,
                stack: run.error.stack?.substring(0, 800) || null,
                httpCode: run.error.httpCode || run.error.statusCode || null,
                context: run.error.context || null,
                cause: run.error.cause?.message || null,
                nodeType: run.error.node?.type || null,
              };
            }

            // Also check for item-level errors
            const itemErrors = outputData
              .filter((item: any) => item.error)
              .slice(0, 3)
              .map((item: any) => ({
                message: item.error.message || item.error,
                json: item.json,
              }));

            return {
              nodeName: nName,
              runIndex: idx,
              executionStatus: run.executionStatus,
              startTime: run.startTime,
              executionTime: run.executionTime,
              itemCount,
              error: errorDetails,
              ...(itemErrors.length > 0 ? { itemErrors } : {}),
              outputSample: sampleItems,
              ...(itemCount > maxItems ? { note: `Showing ${maxItems} of ${itemCount} items. Increase maxItems to see more.` } : {}),
            };
          });
        }).flat();

        // Summary of errors for quick diagnosis
        const failedNodes = nodeSummaries.filter((n: any) => n.error);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              executionId: id,
              status: exec.status,
              startedAt: exec.startedAt,
              stoppedAt: exec.stoppedAt,
              totalNodes: nodeNames.length,
              showingNodes: filteredNames.length,
              failedNodeCount: failedNodes.length,
              ...(failedNodes.length > 0 ? {
                errorSummary: failedNodes.map((n: any) => `${n.nodeName}: ${n.error?.message}`).join(' | '),
              } : {}),
              ...(lastError ? { workflowError: { message: lastError.message, description: lastError.description } } : {}),
              nodes: nodeSummaries,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Execution Data Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'list_node_types') {
      try {
        const { search } = args as any;
        // Scan all workflows to extract unique node types
        const allWorkflows: any[] = [];
        let cursor: string | undefined;
        do {
          const params: any = { limit: 100 };
          if (cursor) params.cursor = cursor;
          const resp = await n8n.get('/workflows', { params });
          allWorkflows.push(...(resp.data.data || []));
          cursor = resp.data.nextCursor;
        } while (cursor);

        // Count node types across all workflows
        const typeMap: Record<string, { count: number; workflows: string[] }> = {};
        for (const wf of allWorkflows) {
          if (!wf.nodes) continue;
          const seen = new Set<string>();
          for (const node of wf.nodes) {
            const t = node.type || '';
            if (!t) continue;
            if (!typeMap[t]) typeMap[t] = { count: 0, workflows: [] };
            typeMap[t].count++;
            if (!seen.has(t)) {
              seen.add(t);
              typeMap[t].workflows.push(wf.name);
            }
          }
        }

        let entries = Object.entries(typeMap);
        if (search) {
          const s = search.toLowerCase();
          entries = entries.filter(([type]) => type.toLowerCase().includes(s));
        }
        entries.sort((a, b) => b[1].count - a[1].count);

        const nodeTypes = entries.map(([type, info]) => ({
          type,
          shortName: type.split('.').pop(),
          instanceCount: info.count,
          usedInWorkflows: info.workflows.length,
          sampleWorkflows: info.workflows.slice(0, 3),
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalNodeTypes: nodeTypes.length,
              totalWorkflowsScanned: allWorkflows.length,
              nodeTypes,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `List Node Types Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    // --- COMMUNITY TEMPLATES ---
    if (name === 'search_templates') {
      const { search, category, rows = 10, page = 1 } = args as any;
      try {
        const params: any = { rows: Math.min(rows, 50), page };
        if (search) params.search = search;
        if (category) params.category = category;

        const response = await n8nTemplates.get('/search', { params });
        const { workflows, totalWorkflows } = response.data;

        // Return a clean summary for AI consumption
        const results = workflows.map((w: any) => ({
          id: w.id,
          name: w.name,
          description: w.description?.substring(0, 200),
          totalViews: w.totalViews,
          createdAt: w.createdAt,
          nodes: w.nodes?.map((n: any) => n.displayName || n.type),
          url: `https://n8n.io/workflows/${w.id}`,
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalWorkflows,
              showing: results.length,
              page,
              workflows: results,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Templates Search Error: ${err.message}` }] };
      }
    }

    if (name === 'get_template') {
      const { id } = args as any;
      try {
        const response = await n8nTemplates.get(`/workflows/${id}`);
        const template = response.data.workflow;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: template.id,
              name: template.name,
              description: template.description,
              nodes: template.workflow?.nodes,
              connections: template.workflow?.connections,
              url: `https://n8n.io/workflows/${id}`,
              hint: 'Use create_workflow with the nodes and connections above to import this template.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Template Fetch Error: ${err.message}` }] };
      }
    }

    // --- CREDENTIALS MANAGEMENT ---
    if (name === 'get_credential_schema') {
      const { credentialTypeName } = args as any;
      try {
        const searchTerm = credentialTypeName.toLowerCase();

        // Scan workflows to find credential type usage
        const allWorkflows: any[] = [];
        let cursor: string | undefined;
        do {
          const params: any = { limit: 100 };
          if (cursor) params.cursor = cursor;
          const resp = await n8n.get('/workflows', { params });
          allWorkflows.push(...(resp.data.data || []));
          cursor = resp.data.nextCursor;
        } while (cursor);

        const credentialTypeMap: Record<string, { nodes: string[]; workflows: string[] }> = {};

        for (const wf of allWorkflows) {
          if (!wf.nodes) continue;
          for (const node of wf.nodes) {
            if (!node.credentials) continue;
            for (const [credType, credInfo] of Object.entries(node.credentials as Record<string, any>)) {
              if (!credType.toLowerCase().includes(searchTerm)) continue;
              if (!credentialTypeMap[credType]) credentialTypeMap[credType] = { nodes: [], workflows: [] };
              const nodeDesc = `${node.name} (${node.type})`;
              if (!credentialTypeMap[credType].nodes.includes(nodeDesc)) {
                credentialTypeMap[credType].nodes.push(nodeDesc);
              }
              if (!credentialTypeMap[credType].workflows.includes(wf.name)) {
                credentialTypeMap[credType].workflows.push(wf.name);
              }
            }
          }
        }

        if (Object.keys(credentialTypeMap).length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `No credential type matching "${credentialTypeName}" found in your workflows.`,
                hint: 'Try a broader search term, or use list_node_types to see what integrations are in use.',
                totalWorkflowsScanned: allWorkflows.length,
              }, null, 2)
            }]
          };
        }

        const results = Object.entries(credentialTypeMap).map(([credType, info]) => ({
          credentialType: credType,
          usedByNodes: info.nodes.slice(0, 10),
          usedInWorkflows: info.workflows.slice(0, 5),
          hint: `Use create_credential with type: "${credType}" to create a new credential of this type.`,
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalMatches: results.length,
              credentialTypes: results,
              totalWorkflowsScanned: allWorkflows.length,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Credential Schema Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'create_credential') {
      const { name: credName, type, data } = args as any;
      try {
        const response = await n8n.post('/credentials', {
          name: credName,
          type,
          data,
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              credential: {
                id: response.data.id,
                name: response.data.name,
                type: response.data.type,
                createdAt: response.data.createdAt,
              },
              hint: 'Use this credential ID when configuring nodes in workflows.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Create Credential Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'delete_credential') {
      const { id } = args as any;
      try {
        await n8n.delete(`/credentials/${id}`);
        return { content: [{ type: 'text', text: `Successfully deleted credential ${id}` }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Delete Credential Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    // --- NODE TYPE DETAILS ---
    if (name === 'get_node_type_details') {
      const { nodeType } = args as any;
      try {
        const searchTerm = nodeType.toLowerCase();

        // Fetch all workflows
        const allWorkflows: any[] = [];
        let cursor: string | undefined;
        do {
          const params: any = { limit: 100 };
          if (cursor) params.cursor = cursor;
          const resp = await n8n.get('/workflows', { params });
          allWorkflows.push(...(resp.data.data || []));
          cursor = resp.data.nextCursor;
        } while (cursor);

        // Find matching nodes across all workflows
        const matchingNodes: any[] = [];
        const workflowsUsing: { id: string; name: string }[] = [];

        for (const wf of allWorkflows) {
          if (!wf.nodes) continue;
          let found = false;
          for (const node of wf.nodes) {
            const type = (node.type || '').toLowerCase();
            if (type === searchTerm || type.includes(searchTerm)) {
              matchingNodes.push(node);
              found = true;
            }
          }
          if (found) {
            workflowsUsing.push({ id: wf.id, name: wf.name });
          }
        }

        if (matchingNodes.length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `No nodes matching "${nodeType}" found in your workflows.`,
                hint: 'Try a different search term, or check n8n docs at https://docs.n8n.io/integrations/builtin/',
                totalWorkflowsScanned: allWorkflows.length,
              }, null, 2)
            }]
          };
        }

        // Extract unique info
        const nodeTypes = [...new Set(matchingNodes.map(n => n.type))];
        const typeVersions = [...new Set(matchingNodes.map(n => n.typeVersion))];
        const credentials = matchingNodes
          .filter(n => n.credentials)
          .map(n => n.credentials);
        const uniqueCredTypes = [...new Set(
          credentials.flatMap(c => Object.keys(c))
        )];

        // Get unique parameter structures (sample up to 5)
        const paramExamples = matchingNodes
          .slice(0, 5)
          .map(n => ({
            nodeName: n.name,
            type: n.type,
            typeVersion: n.typeVersion,
            parameters: n.parameters,
            credentials: n.credentials || null,
          }));

        // Build docs URL hint
        const primaryType = nodeTypes[0] || '';
        const parts = primaryType.split('.');
        const shortName = parts[parts.length - 1] || nodeType;
        const docsUrl = `https://docs.n8n.io/integrations/builtin/core-nodes/${primaryType}/`;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              nodeTypes,
              typeVersions,
              totalInstancesFound: matchingNodes.length,
              usedInWorkflows: workflowsUsing,
              credentialTypes: uniqueCredTypes,
              parameterExamples: paramExamples,
              docsUrl,
              hint: `Found ${matchingNodes.length} instances of "${nodeType}" across ${workflowsUsing.length} workflows. Parameter examples show real configurations from your n8n instance.`,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Node Type Details Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    // --- NODE SCHEMA (NEW v2.3.0) ---
    if (name === 'get_node_schema') {
      const { nodeType, version } = args as any;
      try {
        // Use internal n8n REST API (not /api/v1) for node type info
        // This endpoint is used by the n8n frontend and returns full parameter schemas
        const response = await n8nInternal.post('/rest/node-types', {
          nodeFilter: { name: nodeType },
        });

        const nodeTypeData = response.data;

        // If the response is an array, find the matching version
        let targetNode = nodeTypeData;
        if (Array.isArray(nodeTypeData)) {
          targetNode = version
            ? nodeTypeData.find((n: any) => n.typeVersion === version) || nodeTypeData[0]
            : nodeTypeData[nodeTypeData.length - 1]; // latest version
        }

        // Extract useful schema info
        const schema = {
          type: targetNode?.name || nodeType,
          displayName: targetNode?.displayName || null,
          description: targetNode?.description || null,
          group: targetNode?.group || null,
          version: targetNode?.version || targetNode?.typeVersion || null,
          defaults: targetNode?.defaults || null,
          inputs: targetNode?.inputs || null,
          outputs: targetNode?.outputs || null,
          credentials: targetNode?.credentials?.map((c: any) => ({
            name: c.name,
            required: c.required || false,
            displayName: c.displayName || c.name,
          })) || [],
          properties: targetNode?.properties?.map((p: any) => ({
            name: p.name,
            displayName: p.displayName,
            type: p.type,
            default: p.default,
            required: p.required || false,
            description: p.description || null,
            options: p.options?.map((o: any) => ({
              name: o.name,
              value: o.value,
              description: o.description,
            }))?.slice(0, 20) || undefined,
            displayOptions: p.displayOptions || undefined,
          })) || [],
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              schema,
              totalProperties: schema.properties.length,
              totalCredentials: schema.credentials.length,
              hint: 'Use these property names and types when configuring nodes via create_workflow or patch_workflow_node. The options arrays show valid values for enum-type parameters.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        const status = err.response?.status;
        let tip = '';
        if (status === 404 || status === 400) {
          tip = ' This endpoint may not be available in your n8n version. Fallback: use get_node_type_details to scan existing workflows for usage examples, or check docs at https://docs.n8n.io/integrations/builtin/';
        }
        if (status === 401 || status === 403) {
          tip = ' The node-types endpoint may require session auth instead of API key. Fallback: use get_node_type_details instead.';
        }
        return { isError: true, content: [{ type: 'text', text: `Node Schema Error: ${err.response?.data?.message || err.message}${tip}` }] };
      }
    }

    // --- TAG MANAGEMENT ---
    if (name === 'list_tags') {
      try {
        const response = await n8n.get('/tags', { params: { limit: 100 } });
        const tags = (response.data.data || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));
        return { content: [{ type: 'text', text: JSON.stringify({ totalTags: tags.length, tags }, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `List Tags Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'create_tag') {
      const { name: tagName } = args as any;
      try {
        const response = await n8n.post('/tags', { name: tagName });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, tag: { id: response.data.id, name: response.data.name } }, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Create Tag Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'update_tag') {
      const { id, name: newName } = args as any;
      try {
        const response = await n8n.put(`/tags/${id}`, { name: newName });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, tag: { id: response.data.id, name: response.data.name } }, null, 2) }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Update Tag Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'delete_tag') {
      const { id } = args as any;
      try {
        await n8n.delete(`/tags/${id}`);
        return { content: [{ type: 'text', text: `Successfully deleted tag ${id}` }] };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Delete Tag Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'tag_workflow') {
      const { workflowId, tagIds } = args as any;
      try {
        // Fetch current workflow to preserve nodes/connections
        const current = await n8n.get(`/workflows/${workflowId}`);
        const wf = current.data;

        // Update workflow with new tags (strip id/versionId to avoid PUT conflicts)
        const tags = tagIds.map((id: string) => ({ id }));
        const { id: _id, versionId: _v, ...updateBody } = wf;
        const response = await n8n.put(`/workflows/${workflowId}`, {
          ...updateBody,
          tags,
        });

        const assignedTags = (response.data.tags || []).map((t: any) => ({ id: t.id, name: t.name }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              workflow: { id: response.data.id, name: response.data.name },
              tags: assignedTags,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Tag Workflow Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    // --- CREDENTIALS DISCOVERY (NEW v2.2.0) ---
    if (name === 'list_credentials') {
      try {
        const { type: credType } = (args || {}) as any;
        // Paginate through all credentials
        const allCredentials: any[] = [];
        let cursor: string | undefined;
        do {
          const params: any = { limit: 100 };
          if (cursor) params.cursor = cursor;
          const response = await n8n.get('/credentials', { params });
          allCredentials.push(...(response.data.data || []));
          cursor = response.data.nextCursor;
        } while (cursor);

        let credentials = allCredentials.map((c: any) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));

        // Filter by type if specified
        if (credType) {
          const search = credType.toLowerCase();
          credentials = credentials.filter((c: any) => c.type.toLowerCase().includes(search));
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              total: credentials.length,
              credentials,
              hint: 'Use the credential ID when configuring nodes. Use update_credential to modify existing credentials without breaking workflow references.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `List Credentials Error: ${err.response?.data?.message || err.message}. Tip: Ensure your API key has credential:list scope.` }] };
      }
    }

    if (name === 'update_credential') {
      const { id, name: credName, type: credType, data } = args as any;
      try {
        const body: any = { type: credType };
        if (credName) body.name = credName;
        if (data) body.data = data;

        const response = await n8n.patch(`/credentials/${id}`, body);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              credential: {
                id: response.data.id,
                name: response.data.name,
                type: response.data.type,
                updatedAt: response.data.updatedAt,
              },
              hint: 'Credential updated. All workflows referencing this credential ID will automatically use the new values.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        const status = err.response?.status;
        let tip = '';
        if (status === 404) tip = ' Tip: Credential ID not found. Use list_credentials to find valid IDs.';
        if (status === 403) tip = ' Tip: API key may lack credential:update scope.';
        if (status === 400) tip = ' Tip: The "type" field is required and must match the credential\'s actual type.';
        return { isError: true, content: [{ type: 'text', text: `Update Credential Error: ${err.response?.data?.message || err.message}${tip}` }] };
      }
    }

    // --- SURGICAL WORKFLOW EDITING (NEW v2.2.0) ---
    if (name === 'patch_workflow_node') {
      const { workflowId, nodeName, parameters, credentials, disabled } = args as any;
      try {
        // 1. Fetch current workflow
        const current = await n8n.get(`/workflows/${workflowId}`);
        const wf = current.data;

        // 2. Find the target node by name
        const nodeIndex = wf.nodes.findIndex((n: any) => n.name === nodeName);
        if (nodeIndex === -1) {
          const availableNodes = wf.nodes.map((n: any) => n.name);
          return {
            isError: true,
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Node "${nodeName}" not found in workflow "${wf.name}".`,
                availableNodes,
                hint: 'Use one of the available node names listed above. Names are case-sensitive.',
              }, null, 2)
            }]
          };
        }

        // 3. Save snapshot of original node for diff
        const originalNode = JSON.parse(JSON.stringify(wf.nodes[nodeIndex]));

        // 4. Apply patches (shallow merge for parameters)
        if (parameters) {
          wf.nodes[nodeIndex].parameters = {
            ...wf.nodes[nodeIndex].parameters,
            ...parameters,
          };
        }
        if (credentials) {
          wf.nodes[nodeIndex].credentials = {
            ...wf.nodes[nodeIndex].credentials,
            ...credentials,
          };
        }
        if (disabled !== undefined) {
          wf.nodes[nodeIndex].disabled = disabled;
        }

        // 5. Push updated workflow back
        const { id: _id, versionId: _v, ...updateBody } = wf;
        const response = await n8n.put(`/workflows/${workflowId}`, updateBody);

        // 6. Find the patched node in response for verification
        const patchedNode = response.data.nodes.find((n: any) => n.name === nodeName);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              workflow: { id: response.data.id, name: response.data.name },
              nodeName,
              before: {
                parameters: originalNode.parameters,
                credentials: originalNode.credentials || null,
                disabled: originalNode.disabled || false,
              },
              after: {
                parameters: patchedNode?.parameters,
                credentials: patchedNode?.credentials || null,
                disabled: patchedNode?.disabled || false,
              },
              hint: 'Node patched successfully. Use execute_workflow to test the fix, then get_execution_data to verify.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Patch Node Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'validate_workflow') {
      const { nodes, connections } = args as any;
      try {
        const issues: string[] = [];
        const nodeNames = new Set<string>();

        if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
          issues.push('CRITICAL: No nodes provided. A workflow must have at least one node.');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ valid: false, issueCount: issues.length, issues }, null, 2)
            }]
          };
        }

        // Check each node
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (!node.name) issues.push(`ERROR: Node at index ${i} has no 'name' field.`);
          if (!node.type) issues.push(`ERROR: Node "${node.name || `index:${i}`}" has no 'type' field.`);
          if (node.name && nodeNames.has(node.name)) {
            issues.push(`ERROR: Duplicate node name "${node.name}". Each node must have a unique name.`);
          }
          if (node.name) nodeNames.add(node.name);
          if (!node.position) issues.push(`WARNING: Node "${node.name || `index:${i}`}" has no 'position'. n8n may auto-position it.`);
          if (node.typeVersion === undefined) issues.push(`WARNING: Node "${node.name || `index:${i}`}" has no 'typeVersion'. n8n may use default version.`);
        }

        // Check for trigger node
        const triggerTypes = ['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.scheduleTrigger',
          'n8n-nodes-base.webhook', 'n8n-nodes-base.executeWorkflowTrigger',
          'n8n-nodes-base.cronTrigger', 'n8n-nodes-base.emailTrigger'];
        const hasTrigger = nodes.some((n: any) =>
          triggerTypes.some(t => (n.type || '').toLowerCase().includes(t.split('.')[1].toLowerCase())) ||
          (n.type || '').toLowerCase().includes('trigger')
        );
        if (!hasTrigger) {
          issues.push('WARNING: No trigger node found. Workflow cannot be activated without a trigger (webhook, schedule, manual, etc).');
        }

        // Validate connections reference existing nodes
        if (connections && typeof connections === 'object') {
          for (const [sourceName, targets] of Object.entries(connections as Record<string, any>)) {
            if (!nodeNames.has(sourceName)) {
              issues.push(`ERROR: Connection source "${sourceName}" does not match any node name.`);
            }
            // Check target references
            const mainTargets = (targets as any)?.main;
            if (Array.isArray(mainTargets)) {
              for (const outputGroup of mainTargets) {
                if (Array.isArray(outputGroup)) {
                  for (const conn of outputGroup) {
                    if (conn.node && !nodeNames.has(conn.node)) {
                      issues.push(`ERROR: Connection target "${conn.node}" (from "${sourceName}") does not match any node name.`);
                    }
                  }
                }
              }
            }
          }
        }

        const valid = !issues.some(i => i.startsWith('ERROR') || i.startsWith('CRITICAL'));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              valid,
              totalNodes: nodes.length,
              issueCount: issues.length,
              issues: issues.length > 0 ? issues : ['All checks passed.'],
              hint: valid
                ? 'Workflow structure looks valid. Safe to deploy with create_workflow or update_workflow.'
                : 'Fix the ERROR/CRITICAL issues before deploying. WARNING items are recommendations.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Validate Workflow Error: ${err.message}` }] };
      }
    }

    // --- PRODUCTIVITY TOOLS (NEW v2.4.0) ---
    if (name === 'import_template') {
      const { templateId, name: customName, activate = false } = args as any;
      try {
        // Step 1: Fetch template from n8n.io
        const templateResp = await n8nTemplates.get(`/workflows/${templateId}`);
        const template = templateResp.data.workflow;

        if (!template?.workflow?.nodes) {
          return { isError: true, content: [{ type: 'text', text: `Import Template Error: Template ${templateId} has no workflow data.` }] };
        }

        // Step 2: Create workflow from template
        const workflowData = {
          name: customName || template.name || `Imported Template #${templateId}`,
          nodes: template.workflow.nodes,
          connections: template.workflow.connections || {},
          settings: template.workflow.settings || {},
          active: false,
        };

        const created = await n8n.post('/workflows', workflowData);

        // Step 3: Activate if requested
        if (activate && created.data.id) {
          await n8n.post(`/workflows/${created.data.id}/activate`);
        }

        // Extract credential types needed
        const credTypesNeeded = new Set<string>();
        for (const node of template.workflow.nodes) {
          if (node.credentials) {
            for (const credType of Object.keys(node.credentials)) {
              credTypesNeeded.add(credType);
            }
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              templateId,
              templateName: template.name,
              workflow: {
                id: created.data.id,
                name: created.data.name,
                active: activate,
                nodeCount: template.workflow.nodes.length,
              },
              credentialTypesNeeded: [...credTypesNeeded],
              templateUrl: `https://n8n.io/workflows/${templateId}`,
              hint: credTypesNeeded.size > 0
                ? `This template requires ${credTypesNeeded.size} credential type(s): ${[...credTypesNeeded].join(', ')}. Use list_credentials to find matching credentials, then patch_workflow_node to assign them.`
                : 'Template imported successfully. No credentials needed.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Import Template Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'get_workflow_summary') {
      const { id } = args as any;
      try {
        const response = await n8n.get(`/workflows/${id}`);
        const wf = response.data;
        const nodes = wf.nodes || [];
        const connections = wf.connections || {};

        // Build node list with types
        const nodeList = nodes.map((n: any) => ({
          name: n.name,
          type: n.type?.split('.').pop() || n.type,
          fullType: n.type,
          disabled: n.disabled || false,
          hasCredentials: !!n.credentials,
        }));

        // Find trigger node
        const triggerNode = nodes.find((n: any) => (n.type || '').toLowerCase().includes('trigger'));

        // Build connection flow (simplified)
        const flow: string[] = [];
        for (const [source, targets] of Object.entries(connections as Record<string, any>)) {
          const mainTargets = targets?.main;
          if (Array.isArray(mainTargets)) {
            for (const outputGroup of mainTargets) {
              if (Array.isArray(outputGroup)) {
                for (const conn of outputGroup) {
                  if (conn.node) {
                    flow.push(`${source} → ${conn.node}`);
                  }
                }
              }
            }
          }
        }

        // Extract unique credential types
        const credTypes = new Set<string>();
        for (const node of nodes) {
          if (node.credentials) {
            for (const ct of Object.keys(node.credentials)) {
              credTypes.add(ct);
            }
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: wf.id,
              name: wf.name,
              active: wf.active,
              triggerType: triggerNode ? triggerNode.type?.split('.').pop() : 'none',
              nodeCount: nodes.length,
              nodes: nodeList,
              connectionFlow: flow,
              credentialTypes: [...credTypes],
              settings: {
                executionOrder: wf.settings?.executionOrder || 'default',
                errorWorkflow: wf.settings?.errorWorkflow || null,
                timezone: wf.settings?.timezone || null,
              },
              tags: wf.tags?.map((t: any) => t.name) || [],
              updatedAt: wf.updatedAt,
              hint: `Workflow has ${nodes.length} nodes with ${flow.length} connections. ${credTypes.size > 0 ? `Uses ${credTypes.size} credential type(s).` : 'No credentials needed.'}`,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Workflow Summary Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    if (name === 'clone_credentials') {
      const { sourceWorkflowId, targetWorkflowId } = args as any;
      try {
        // Fetch both workflows
        const [sourceResp, targetResp] = await Promise.all([
          n8n.get(`/workflows/${sourceWorkflowId}`),
          n8n.get(`/workflows/${targetWorkflowId}`),
        ]);
        const sourceWf = sourceResp.data;
        const targetWf = targetResp.data;

        // Build credential map from source: nodeType → credentials
        const credMap: Record<string, any> = {};
        for (const node of sourceWf.nodes || []) {
          if (node.credentials && node.type) {
            credMap[node.type] = node.credentials;
          }
        }

        // Apply credentials to matching target nodes
        let patchedCount = 0;
        const patches: { nodeName: string; nodeType: string; credentials: any }[] = [];

        for (const node of targetWf.nodes || []) {
          if (node.type && credMap[node.type]) {
            node.credentials = { ...node.credentials, ...credMap[node.type] };
            patchedCount++;
            patches.push({
              nodeName: node.name,
              nodeType: node.type?.split('.').pop(),
              credentials: credMap[node.type],
            });
          }
        }

        if (patchedCount === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: 'No matching node types found between source and target workflows.',
                sourceNodeTypes: [...new Set(sourceWf.nodes?.filter((n: any) => n.credentials).map((n: any) => n.type))],
                targetNodeTypes: [...new Set(targetWf.nodes?.map((n: any) => n.type))],
                hint: 'Credentials are copied by matching node types. Use patch_workflow_node to manually assign credentials to specific nodes.',
              }, null, 2)
            }]
          };
        }

        // Save updated target workflow
        const { id: _id, versionId: _v, ...updateBody } = targetWf;
        const updated = await n8n.put(`/workflows/${targetWorkflowId}`, updateBody);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              source: { id: sourceWf.id, name: sourceWf.name },
              target: { id: updated.data.id, name: updated.data.name },
              patchedNodes: patchedCount,
              patches,
              hint: `Cloned credentials to ${patchedCount} node(s). Use execute_workflow_and_wait to test the target workflow.`,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Clone Credentials Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    // --- EXECUTION MANAGEMENT (NEW v2.5.0) ---
    if (name === 'delete_execution') {
      const { id, ids } = args as any;
      try {
        const toDelete: string[] = [];
        if (id) toDelete.push(id);
        if (ids && Array.isArray(ids)) toDelete.push(...ids);

        if (toDelete.length === 0) {
          return { isError: true, content: [{ type: 'text', text: 'Error: Provide either "id" (single) or "ids" (array) of execution IDs to delete.' }] };
        }

        const results: { id: string; status: string }[] = [];
        for (const execId of toDelete) {
          try {
            await n8n.delete(`/executions/${execId}`);
            results.push({ id: execId, status: 'deleted' });
          } catch (err: any) {
            results.push({ id: execId, status: `error: ${err.response?.data?.message || err.message}` });
          }
        }

        const successCount = results.filter(r => r.status === 'deleted').length;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: successCount === toDelete.length,
              deleted: successCount,
              total: toDelete.length,
              results,
              hint: successCount > 0
                ? `Deleted ${successCount} execution(s). The workflow can now create new executions.`
                : 'No executions were deleted. Check the IDs and try again.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Delete Execution Error: ${err.message}` }] };
      }
    }

    // --- NODE VERSION DISCOVERY (NEW v2.5.0) ---
    if (name === 'get_node_versions') {
      const { nodeType } = args as any;
      try {
        // Strategy 1: Use n8n internal API to get node type info with all versions
        let nodeData: any = null;
        try {
          const response = await n8nInternal.post('/rest/node-types', {
            nodeFilter: { name: nodeType },
          });
          nodeData = response.data;
        } catch (internalErr: any) {
          // Fallback: internal API might need session auth
        }

        // Extract version info
        let versions: number[] = [];
        let latestVersion: number | null = null;
        let defaultParameters: any = null;
        let displayName: string | null = null;
        let credentials: any[] = [];

        if (nodeData) {
          // Internal API returns node type data
          const nodes = Array.isArray(nodeData) ? nodeData : (nodeData.data ? [nodeData.data] : [nodeData]);
          const matchingNode = nodes.find((n: any) => n.name === nodeType) || nodes[0];

          if (matchingNode) {
            // n8n stores version as number or array
            const ver = matchingNode.version;
            if (Array.isArray(ver)) {
              versions = ver.sort((a: number, b: number) => a - b);
            } else if (typeof ver === 'number') {
              versions = [ver];
            }
            // Some nodes expose defaultVersion
            latestVersion = matchingNode.defaultVersion || versions[versions.length - 1] || null;
            displayName = matchingNode.displayName || null;
            defaultParameters = matchingNode.defaults || null;
            credentials = (matchingNode.credentials || []).map((c: any) => ({
              name: c.name,
              required: c.required || false,
            }));
          }
        }

        // Strategy 2: Also scan existing workflows for real typeVersion usage
        const allWorkflows: any[] = [];
        let cursor: string | undefined;
        do {
          const params: any = { limit: 100 };
          if (cursor) params.cursor = cursor;
          const resp = await n8n.get('/workflows', { params });
          allWorkflows.push(...(resp.data.data || []));
          cursor = resp.data.nextCursor;
        } while (cursor);

        const usedVersions = new Set<number>();
        const usageExamples: { workflowName: string; nodeName: string; typeVersion: number }[] = [];

        for (const wf of allWorkflows) {
          if (!wf.nodes) continue;
          for (const node of wf.nodes) {
            if (node.type === nodeType && node.typeVersion) {
              usedVersions.add(node.typeVersion);
              if (usageExamples.length < 5) {
                usageExamples.push({
                  workflowName: wf.name,
                  nodeName: node.name,
                  typeVersion: node.typeVersion,
                });
              }
            }
          }
        }

        // Merge versions from both sources
        const allVersions = [...new Set([...versions, ...usedVersions])].sort((a, b) => a - b);
        const highestUsed = usedVersions.size > 0 ? Math.max(...usedVersions) : null;
        const recommended = latestVersion || highestUsed || (allVersions.length > 0 ? allVersions[allVersions.length - 1] : null);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              nodeType,
              displayName,
              recommendedVersion: recommended,
              latestFromSchema: latestVersion,
              highestUsedInWorkflows: highestUsed,
              allKnownVersions: allVersions,
              requiredCredentials: credentials,
              defaultParameters,
              usageExamples,
              hint: recommended
                ? `Use typeVersion: ${recommended} when creating nodes of type "${nodeType}". This is the latest known version.`
                : `Could not determine versions for "${nodeType}". Check if the node type name is correct (full format: "n8n-nodes-base.nodeName").`,
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Get Node Versions Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    // --- DEEP WORKFLOW DIAGNOSIS (NEW v2.5.0) ---
    if (name === 'diagnose_workflow') {
      const { id } = args as any;
      try {
        const issues: { severity: 'critical' | 'error' | 'warning' | 'info'; category: string; message: string; node?: string }[] = [];

        // 1. Fetch workflow
        const wfResponse = await n8n.get(`/workflows/${id}`);
        const wf = wfResponse.data;
        const nodes = wf.nodes || [];
        const connections = wf.connections || {};

        // 2. Structural checks
        const nodeNames = new Set(nodes.map((n: any) => n.name));
        const hasTrigger = nodes.some((n: any) => (n.type || '').toLowerCase().includes('trigger') || (n.type || '').toLowerCase().includes('webhook'));
        if (!hasTrigger) issues.push({ severity: 'error', category: 'structure', message: 'No trigger node found. Workflow cannot be activated.' });

        // Check duplicate names
        const nameCount: Record<string, number> = {};
        for (const n of nodes) { nameCount[n.name] = (nameCount[n.name] || 0) + 1; }
        for (const [name, count] of Object.entries(nameCount)) {
          if (count > 1) issues.push({ severity: 'error', category: 'structure', message: `Duplicate node name: "${name}" (${count} times)`, node: name });
        }

        // 3. Connection integrity
        const connectedNodes = new Set<string>();
        for (const [source, targets] of Object.entries(connections as Record<string, any>)) {
          connectedNodes.add(source);
          if (!nodeNames.has(source)) {
            issues.push({ severity: 'error', category: 'connection', message: `Connection source "${source}" not found in nodes` });
          }
          const mainTargets = targets?.main;
          if (Array.isArray(mainTargets)) {
            for (const group of mainTargets) {
              if (Array.isArray(group)) {
                for (const conn of group) {
                  if (conn.node) {
                    connectedNodes.add(conn.node);
                    if (!nodeNames.has(conn.node)) {
                      issues.push({ severity: 'error', category: 'connection', message: `Connection target "${conn.node}" not found in nodes`, node: source });
                    }
                  }
                }
              }
            }
          }
          // Also check ai_languageModel connections
          const aiTargets = targets?.ai_languageModel;
          if (Array.isArray(aiTargets)) {
            for (const group of aiTargets) {
              if (Array.isArray(group)) {
                for (const conn of group) {
                  if (conn.node) connectedNodes.add(conn.node);
                }
              }
            }
          }
        }

        // Find orphan nodes
        for (const node of nodes) {
          if (!connectedNodes.has(node.name) && !(node.type || '').toLowerCase().includes('trigger') && !(node.type || '').toLowerCase().includes('webhook')) {
            issues.push({ severity: 'warning', category: 'connection', message: `Orphan node: "${node.name}" has no connections`, node: node.name });
          }
        }

        // 4. Credential existence check
        let allCredentials: any[] = [];
        try {
          let credCursor: string | undefined;
          do {
            const params: any = { limit: 100 };
            if (credCursor) params.cursor = credCursor;
            const credResp = await n8n.get('/credentials', { params });
            allCredentials.push(...(credResp.data.data || []));
            credCursor = credResp.data.nextCursor;
          } while (credCursor);
        } catch (e) {
          issues.push({ severity: 'info', category: 'credential', message: 'Could not fetch credentials list (API key may lack credential:list scope)' });
        }

        const credIds = new Set(allCredentials.map((c: any) => c.id));
        for (const node of nodes) {
          if (node.credentials) {
            for (const [credType, credInfo] of Object.entries(node.credentials as Record<string, any>)) {
              if (credInfo?.id && !credIds.has(credInfo.id)) {
                issues.push({ severity: 'critical', category: 'credential', message: `Credential "${credInfo.name || credInfo.id}" (type: ${credType}) not found in n8n. Node will fail at runtime.`, node: node.name });
              }
            }
          }
        }

        // Nodes that need credentials but don't have them
        const credRequiredTypes = ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.gmail', 'n8n-nodes-base.slack',
          '@n8n/n8n-nodes-langchain.lmChatOpenAi', '@n8n/n8n-nodes-langchain.lmChatAnthropic'];
        for (const node of nodes) {
          if (credRequiredTypes.some(t => node.type === t) && !node.credentials) {
            issues.push({ severity: 'error', category: 'credential', message: `Node requires credentials but none assigned`, node: node.name });
          }
        }

        // 5. Code node sandbox compatibility
        for (const node of nodes) {
          if (node.type === 'n8n-nodes-base.code' && node.parameters?.jsCode) {
            const code = node.parameters.jsCode;
            if (code.includes('fetch(') || code.includes('fetch (')) {
              issues.push({ severity: 'critical', category: 'sandbox', message: 'Code uses fetch() which is BLOCKED in n8n sandbox. Use HTTP Request node instead.', node: node.name });
            }
            if (code.includes('$helpers.httpRequest') || code.includes('$helpers.request')) {
              issues.push({ severity: 'warning', category: 'sandbox', message: 'Code uses $helpers.httpRequest() which may be blocked in strict sandbox environments. Consider HTTP Request node as fallback.', node: node.name });
            }
            if (code.includes('require(') || code.includes('import ')) {
              issues.push({ severity: 'critical', category: 'sandbox', message: 'Code uses require()/import which is BLOCKED in n8n Code node sandbox.', node: node.name });
            }
            // Check mode
            if (!node.parameters.mode || node.parameters.mode !== 'runOnceForAllItems') {
              issues.push({ severity: 'warning', category: 'config', message: 'Code node missing mode: "runOnceForAllItems". May run per-item unexpectedly.', node: node.name });
            }
          }
        }

        // 6. Node version warnings (scan workflows for highest versions in use)
        const versionMap: Record<string, number> = {};
        try {
          const allWfs: any[] = [];
          let wfCursor: string | undefined;
          do {
            const params: any = { limit: 100 };
            if (wfCursor) params.cursor = wfCursor;
            const resp = await n8n.get('/workflows', { params });
            allWfs.push(...(resp.data.data || []));
            wfCursor = resp.data.nextCursor;
          } while (wfCursor);

          for (const w of allWfs) {
            if (!w.nodes) continue;
            for (const n of w.nodes) {
              if (n.type && n.typeVersion) {
                if (!versionMap[n.type] || n.typeVersion > versionMap[n.type]) {
                  versionMap[n.type] = n.typeVersion;
                }
              }
            }
          }
        } catch (e) { /* ignore scan errors */ }

        for (const node of nodes) {
          if (node.type && node.typeVersion && versionMap[node.type]) {
            if (node.typeVersion < versionMap[node.type]) {
              issues.push({
                severity: 'warning',
                category: 'version',
                message: `Using typeVersion ${node.typeVersion}, but version ${versionMap[node.type]} is used elsewhere. Consider upgrading.`,
                node: node.name,
              });
            }
          }
        }

        // 7. Latest execution status
        let latestExec: any = null;
        try {
          const execResp = await n8n.get('/executions', { params: { workflowId: id, limit: 3 } });
          latestExec = (execResp.data.data || []).map((e: any) => ({
            id: e.id, status: e.status, finished: e.finished,
            startedAt: e.startedAt, mode: e.mode,
          }));
        } catch (e) { /* ignore */ }

        // Summary
        const criticalCount = issues.filter(i => i.severity === 'critical').length;
        const errorCount = issues.filter(i => i.severity === 'error').length;
        const warningCount = issues.filter(i => i.severity === 'warning').length;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              workflowId: id,
              workflowName: wf.name,
              active: wf.active,
              nodeCount: nodes.length,
              healthy: criticalCount === 0 && errorCount === 0,
              summary: {
                critical: criticalCount,
                errors: errorCount,
                warnings: warningCount,
                info: issues.filter(i => i.severity === 'info').length,
              },
              issues: issues.length > 0 ? issues : [{ severity: 'info', category: 'all', message: 'No issues found. Workflow looks healthy!' }],
              latestExecutions: latestExec,
              hint: criticalCount > 0
                ? `CRITICAL: ${criticalCount} critical issue(s) found. Workflow WILL FAIL at runtime. Fix these immediately.`
                : errorCount > 0
                  ? `${errorCount} error(s) found. Workflow may fail. Review and fix before executing.`
                  : warningCount > 0
                    ? `${warningCount} warning(s) found. Workflow should work but review for best practices.`
                    : 'Workflow looks healthy! Safe to execute.',
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Diagnose Workflow Error: ${err.response?.data?.message || err.message}` }] };
      }
    }

    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  } catch (error: any) {
    const errorMsg = error.response?.data?.message || error.message;
    return { isError: true, content: [{ type: 'text', text: `N8N API Error: ${errorMsg}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

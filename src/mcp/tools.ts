import path from 'node:path';

import { lint, allRules, findRule } from '../lint/engine.ts';
import { applyBaseline, loadBaseline } from '../baseline.ts';
import { loadSpecFile } from '../spec/loader.ts';
import { generatePayload } from '../mock/generator.ts';
import { startMockServer } from '../mock/server.ts';
import { compareGolden, MockLiveSource, HttpLiveSource } from '../diff/compare.ts';
import { parseGoldenFile } from '../record/golden.ts';
import { readFileSync } from 'node:fs';
import type { ApiSpec, Operation } from '../spec/model.ts';
import type { Severity } from '../lint/types.ts';
import {
  errorResult,
  textResult,
  type McpTool,
  type McpToolResult,
} from './protocol.ts';

export interface McpToolContext {
  cwd: string;
}

export interface McpToolDefinition {
  tool: McpTool;
  run(args: Record<string, unknown>, context: McpToolContext): Promise<McpToolResult>;
}

class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolInputError(`"${key}" is required and must be a non-empty string.`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ToolInputError(`"${key}" must be a string.`);
  }
  return value;
}

function optionalStringList(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ToolInputError(`"${key}" must be an array of strings.`);
  }
  return value as string[];
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(`"${key}" must be a number.`);
  }
  return value;
}

function resolvePath(context: McpToolContext, target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(context.cwd, target);
}

async function loadDocument(context: McpToolContext, target: string): Promise<ApiSpec> {
  return loadSpecFile(resolvePath(context, target));
}

function findOperation(spec: ApiSpec, method: string, target: string): Operation | undefined {
  const upper = method.toUpperCase();
  for (const operation of spec.operations.values()) {
    if (operation.method.toUpperCase() === upper && operation.path === target) return operation;
  }
  return undefined;
}

function describeOperation(operation: Operation): Record<string, unknown> {
  return {
    method: operation.method.toUpperCase(),
    path: operation.path,
    operationId: operation.operationId ?? null,
    summary: operation.summary ?? null,
    description: operation.description ?? null,
    tags: operation.tags,
    deprecated: operation.deprecated,
    parameters: operation.parameters.map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required,
      description: parameter.description ?? null,
    })),
    requestBody: operation.requestBody
      ? {
          required: operation.requestBody.required,
          contentTypes: [...operation.requestBody.content.keys()],
        }
      : null,
    responses: [...operation.responses.values()].map((response) => ({
      status: response.status,
      description: response.description ?? null,
      contentTypes: [...response.content.keys()],
    })),
    pointer: operation.pointer,
  };
}

const LINT_TOOL: McpToolDefinition = {
  tool: {
    name: 'lint_openapi',
    title: 'Lint an OpenAPI document',
    description:
      'Check an OpenAPI document against the design-convention rules: consistent error envelopes, ' +
      'pagination models, naming, operation metadata, security declarations and documentation. ' +
      'Every finding carries a JSON Pointer into the document and a hint on how to fix it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the OpenAPI document, YAML or JSON.' },
        severity: {
          type: 'string',
          enum: ['error', 'warn', 'info'],
          description: 'The lowest severity to report. Defaults to info, which reports everything.',
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Rule ids to run exclusively. Everything else is skipped.',
        },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Rule ids that never run.',
        },
        baseline: {
          type: 'string',
          description: 'A baseline file. Findings already recorded in it are suppressed.',
        },
      },
      required: ['path'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },

  async run(args, context) {
    const target = requireString(args, 'path');
    const rawSeverity = optionalString(args, 'severity');
    if (rawSeverity !== undefined && !['error', 'warn', 'info'].includes(rawSeverity)) {
      return errorResult(`Invalid severity "${rawSeverity}" (expected error, warn or info).`);
    }
    const severity = (rawSeverity ?? 'info') as Severity;
    const rules = optionalStringList(args, 'rules');
    const ignore = optionalStringList(args, 'ignore');
    const baselinePath = optionalString(args, 'baseline');

    const unknown = (rules ?? []).filter((id) => !findRule(id));
    if (unknown.length > 0) {
      return errorResult(
        `Unknown rule${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Call list_rules for the catalogue.`,
      );
    }

    const spec = await loadDocument(context, target);
    const result = lint(spec, { rules, ignore, minSeverity: severity });

    let findings = result.findings;
    let suppressed = 0;

    if (baselinePath) {
      const baseline = await loadBaseline(resolvePath(context, baselinePath));
      if (baseline.findings.length > 0) {
        const applied = applyBaseline(findings, baseline);
        findings = applied.fresh;
        suppressed = applied.suppressed.length;
      }
    }

    const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
    for (const finding of findings) counts[finding.severity] += 1;

    const summary = `${counts.error} errors, ${counts.warn} warnings, ${counts.info} info`;
    const head =
      findings.length === 0
        ? `${spec.info.title} v${spec.info.version} follows every convention.`
        : `${spec.info.title} v${spec.info.version}: ${summary}.`;

    const lines = [head, ''];
    if (suppressed > 0) {
      lines.push(`${suppressed} known findings suppressed by the baseline.`);
      lines.push('');
    }
    for (const finding of findings.slice(0, 100)) {
      lines.push(`[${finding.severity}] ${finding.ruleId}`);
      lines.push(`  ${finding.message}`);
      lines.push(`  at ${finding.path}`);
      if (finding.hint) lines.push(`  fix: ${finding.hint}`);
      lines.push('');
    }
    if (findings.length > 100) {
      lines.push(`… ${findings.length - 100} more findings.`);
      lines.push('');
    }

    return textResult(lines.join('\n'), {
      document: spec.document,
      title: spec.info.title,
      version: spec.info.version,
      counts,
      total: findings.length,
      suppressed,
      findings,
    });
  },
};

const LIST_RULES_TOOL: McpToolDefinition = {
  tool: {
    name: 'list_rules',
    title: 'List the lint rules',
    description:
      'The catalogue of design-convention rules: id, severity, category and what each one protects. ' +
      'Use it to look up a rule id before passing it to lint_openapi.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Restrict the catalogue to one category: document, operations, paths, parameters, responses, schemas, security, pagination.',
        },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },

  async run(args) {
    const category = optionalString(args, 'category');
    const rules = [...allRules()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((rule) => !category || rule.category === category);

    if (category && rules.length === 0) {
      return errorResult(`Unknown category "${category}".`);
    }

    const lines = [`${rules.length} rules in ${new Set(rules.map((rule) => rule.category)).size} categories.`, ''];
    for (const rule of rules) {
      lines.push(`${rule.id} · ${rule.severity} · ${rule.category}`);
      lines.push(`  ${rule.title}`);
      lines.push(`  ${rule.description}`);
      lines.push('');
    }

    return textResult(lines.join('\n'), {
      total: rules.length,
      rules: rules.map((rule) => ({
        id: rule.id,
        title: rule.title,
        description: rule.description,
        severity: rule.severity,
        category: rule.category,
      })),
    });
  },
};

const LIST_OPERATIONS_TOOL: McpToolDefinition = {
  tool: {
    name: 'list_operations',
    title: 'List the operations of a document',
    description:
      'Every operation in the document with its method, path, operation id, tags, parameters and ' +
      'documented responses. Use it to understand the shape of an API before changing it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the OpenAPI document, YAML or JSON.' },
      },
      required: ['path'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },

  async run(args, context) {
    const target = requireString(args, 'path');
    const spec = await loadDocument(context, target);

    const operations = [...spec.operations.values()]
      .map((operation) => describeOperation(operation))
      .sort((a, b) => `${a['method']} ${a['path']}`.localeCompare(`${b['method']} ${b['path']}`));

    const lines = [`${operations.length} operations in ${spec.info.title} v${spec.info.version}.`, ''];
    for (const operation of operations) {
      lines.push(`${operation['method']} ${operation['path']}`);
      if (operation['operationId']) lines.push(`  operationId: ${operation['operationId']}`);
      if (operation['summary']) lines.push(`  ${operation['summary']}`);
      const statuses = (operation['responses'] as Array<{ status: string }>).map((entry) => entry.status);
      lines.push(`  responses: ${statuses.join(', ')}`);
      lines.push('');
    }

    return textResult(lines.join('\n'), {
      document: spec.document,
      title: spec.info.title,
      version: spec.info.version,
      total: operations.length,
      operations,
    });
  },
};

const EXAMPLE_RESPONSE_TOOL: McpToolDefinition = {
  tool: {
    name: 'example_response',
    title: 'Show an example response',
    description:
      'A realistic response body for one operation, generated from the documented schema. The payload ' +
      'satisfies the schema it came from, so it can be used as a fixture or as a reference when ' +
      'writing a client.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the OpenAPI document, YAML or JSON.' },
        method: { type: 'string', description: 'HTTP method: get, post, put, patch or delete.' },
        operationPath: {
          type: 'string',
          description: 'The API path of the operation, for example /users/{userId}.',
        },
        status: { type: 'number', description: 'The response status code. Defaults to the first success response.' },
      },
      required: ['path', 'method', 'operationPath'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },

  async run(args, context) {
    const target = requireString(args, 'path');
    const method = requireString(args, 'method');
    const operationPath = requireString(args, 'operationPath');
    const status = optionalNumber(args, 'status');

    const spec = await loadDocument(context, target);
    const operation = findOperation(spec, method, operationPath);
    if (!operation) {
      const known = [...spec.operations.values()]
        .filter((entry) => entry.path === operationPath)
        .map((entry) => entry.method.toUpperCase());
      const hint =
        known.length > 0
          ? `${operationPath} supports ${known.join(', ')}.`
          : `No operation ${method.toUpperCase()} ${operationPath}. Call list_operations for the table.`;
      return errorResult(hint);
    }

    const payload = generatePayload(spec, operation, { status });
    let parsed: unknown = payload.body;
    try {
      parsed = JSON.parse(payload.body);
    } catch {
      parsed = payload.body;
    }

    const lines = [
      `${method.toUpperCase()} ${operationPath} → ${payload.status}`,
      payload.contentType ? `content-type: ${payload.contentType}` : '',
      '',
      payload.body,
    ].filter((line) => line !== '');

    return textResult(lines.join('\n'), {
      method: method.toUpperCase(),
      operationPath,
      status: payload.status,
      contentType: payload.contentType ?? null,
      body: parsed,
    });
  },
};

const CHECK_DRIFT_TOOL: McpToolDefinition = {
  tool: {
    name: 'check_contract_drift',
    title: 'Check for contract drift',
    description:
      'Replay a recorded golden file against a live API or against a mock built from an OpenAPI ' +
      'document, and report every difference: status codes, headers and body fields, each addressed ' +
      'by JSON Pointer.',
    inputSchema: {
      type: 'object',
      properties: {
        goldenFile: { type: 'string', description: 'Path to the golden file recorded by apicovenant record.' },
        spec: { type: 'string', description: 'Path to an OpenAPI document. The mock is built from it.' },
        target: { type: 'string', description: 'Base URL of a live API to replay against.' },
      },
      required: ['goldenFile'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },

  async run(args, context) {
    const goldenPath = resolvePath(context, requireString(args, 'goldenFile'));
    const specPath = optionalString(args, 'spec');
    const target = optionalString(args, 'target');

    if (!specPath && !target) {
      return errorResult('Either "spec" or "target" is required.');
    }

    const golden = parseGoldenFile(readFileSync(goldenPath, 'utf8'));
    let source;
    let handle: { close(): Promise<void> } | undefined;
    let spec: ApiSpec | undefined;

    if (specPath) {
      spec = await loadDocument(context, specPath);
      const mock = await startMockServer(spec);
      handle = mock;
      source = new MockLiveSource(mock.url, `mock(${specPath})`);
    } else {
      source = new HttpLiveSource(target as string);
    }

    let report;
    try {
      report = await compareGolden(golden, source, { spec });
    } finally {
      if (handle) await handle.close();
    }

    const lines: string[] = [];
    lines.push(
      report.summary.changed === 0 && report.summary.failed === 0
        ? 'The contract held: no interaction changed.'
        : `The contract drifted: ${report.summary.changed} changed, ${report.summary.unchanged} unchanged, ${report.summary.failed} failed.`,
    );
    lines.push('');
    for (const interaction of report.interactions) {
      if (interaction.skipped) {
        lines.push(`○ ${interaction.key} (skipped, unsafe method)`);
        lines.push('');
        continue;
      }
      if (interaction.error) {
        lines.push(`✖ ${interaction.key}`);
        lines.push(`  request failed: ${interaction.error}`);
        lines.push('');
        continue;
      }
      const changed =
        interaction.status.changed ||
        interaction.body.changed ||
        interaction.headers.some((header) => header.changed) ||
        interaction.schemaViolations.length > 0;
      if (!changed) {
        lines.push(`✓ ${interaction.key}`);
        lines.push('');
        continue;
      }
      lines.push(`✖ ${interaction.key}`);
      if (interaction.status.changed) {
        lines.push(`  status changed ${interaction.status.before} → ${interaction.status.after}`);
      }
      for (const difference of interaction.body.differences.slice(0, 25)) {
        lines.push(`  ${difference.kind} ${difference.path}`);
        lines.push(`    ${JSON.stringify(difference.before)} → ${JSON.stringify(difference.after)}`);
      }
      if (interaction.body.differences.length > 25) {
        lines.push(`  … ${interaction.body.differences.length - 25} more body differences`);
      }
      for (const violation of interaction.schemaViolations) {
        lines.push(`  schema violation at ${violation.path || '/'}: ${violation.message}`);
      }
      lines.push('');
    }

    return textResult(lines.join('\n'), {
      golden: goldenPath,
      source: report.source,
      summary: report.summary,
      interactions: report.interactions.map((interaction) => ({
        method: interaction.method,
        path: interaction.path,
        statusChanged: interaction.status.changed,
        bodyDifferences: interaction.body.differences,
        schemaViolations: interaction.schemaViolations,
        error: interaction.error ?? null,
      })),
    });
  },
};

export const MCP_TOOLS: McpToolDefinition[] = [
  LINT_TOOL,
  LIST_RULES_TOOL,
  LIST_OPERATIONS_TOOL,
  EXAMPLE_RESPONSE_TOOL,
  CHECK_DRIFT_TOOL,
];

export function findMcpTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((definition) => definition.tool.name === name);
}

export async function runMcpTool(
  name: string,
  args: Record<string, unknown>,
  context: McpToolContext,
): Promise<McpToolResult> {
  const definition = findMcpTool(name);
  if (!definition) {
    return errorResult(`Unknown tool: ${name}. Call tools/list for the catalogue.`);
  }
  try {
    return await definition.run(args, context);
  } catch (error) {
    if (error instanceof ToolInputError) return errorResult(error.message);
    return errorResult((error as Error).message ?? String(error));
  }
}

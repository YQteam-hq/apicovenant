import { startMockServer, type MockServerHandle } from '../mock/server.ts';
import type { ApiSpec } from '../spec/model.ts';
import {
  buildContractCases,
  validateContractResponse,
  type ContractCase,
  type ContractCaseResult,
} from './cases.ts';

export interface ContractTestOptions {
  baseUrl?: string;
  includeUnsafe?: boolean;
  maxCases?: number;
  timeoutMs?: number;
}

export interface ContractTestRun {
  target: string;
  cases: ContractCase[];
  results: ContractCaseResult[];
  summary: { total: number; passed: number; failed: number; skipped: number };
}

async function execute(
  baseUrl: string,
  testCase: ContractCase,
  timeoutMs: number,
  spec: ApiSpec,
  operationIndex: Map<string, ApiSpec['operations'][number]>,
): Promise<ContractCaseResult> {
  const started = performance.now();
  const operation = operationIndex.get(`${testCase.method} ${testCase.path}`);

  try {
    const response = await fetch(`${baseUrl}${testCase.requestPath}`, {
      method: testCase.method,
      headers: testCase.headers,
      body: testCase.body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    const text = await response.text();
    const problems = operation
      ? validateContractResponse(spec, operation, response.status, response.headers.get('content-type'), text)
      : [`operation ${testCase.method} ${testCase.path} is missing from the model`];

    return {
      name: testCase.name,
      method: testCase.method,
      path: testCase.path,
      status: problems.length === 0 ? 'pass' : 'fail',
      durationMs: performance.now() - started,
      message: problems.length === 0 ? undefined : problems[0],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: testCase.name,
      method: testCase.method,
      path: testCase.path,
      status: 'fail',
      durationMs: performance.now() - started,
      message: `request failed: ${message}`,
    };
  }
}

export async function runContractTests(
  spec: ApiSpec,
  options: ContractTestOptions = {},
): Promise<ContractTestRun> {
  const cases = buildContractCases(spec, {
    includeUnsafe: options.includeUnsafe,
    maxCases: options.maxCases,
  });

  let mock: MockServerHandle | undefined;
  let baseUrl = options.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl) {
    mock = await startMockServer(spec);
    baseUrl = mock.url;
  }

  const operationIndex = new Map(
    spec.operations.map((operation) => [`${operation.method.toUpperCase()} ${operation.path}`, operation]),
  );

  const results: ContractCaseResult[] = [];
  try {
    for (const testCase of cases) {
      if (testCase.skipped) {
        results.push({
          name: testCase.name,
          method: testCase.method,
          path: testCase.path,
          status: 'skip',
          durationMs: 0,
          message: testCase.skipped,
        });
        continue;
      }
      results.push(await execute(baseUrl, testCase, options.timeoutMs ?? 10_000, spec, operationIndex));
    }
  } finally {
    await mock?.close();
  }

  const summary = {
    total: results.length,
    passed: results.filter((result) => result.status === 'pass').length,
    failed: results.filter((result) => result.status === 'fail').length,
    skipped: results.filter((result) => result.status === 'skip').length,
  };

  return { target: baseUrl, cases, results, summary };
}

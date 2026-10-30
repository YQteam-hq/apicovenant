export { lint, allRules, findRule, selectRules } from './lint/engine.ts';
export type {
  Finding,
  LintOptions,
  LintResult,
  RuleContext,
  RuleDefinition,
  Severity,
} from './lint/types.ts';

export {
  loadSpecFile,
  loadSpecFromText,
  loadSpecFromStdin,
  parseDocument,
  validateDocument,
  detectFormat,
  SpecError,
} from './spec/loader.ts';
export type { LoadOptions } from './spec/loader.ts';

export { buildSpec, componentSchemas, securitySchemes } from './spec/model.ts';
export type {
  ApiSpec,
  HttpMethod,
  MediaType,
  Operation,
  Parameter,
  PathItem,
  RequestBody,
  Response,
  Server,
  SpecInfo,
} from './spec/model.ts';

export { deref, followRef, isRefNode, refName, resolveLocalRef } from './spec/ref.ts';
export { validateSchema, generateExample, deepEqual } from './spec/schema.ts';
export type { JsonSchema, SchemaViolation } from './spec/schema.ts';

export { startMockServer, compilePath, matchRoute } from './mock/server.ts';
export type { MockServerHandle, MockServerOptions } from './mock/server.ts';
export { generatePayload, selectResponse } from './mock/generator.ts';

export { startRecorder } from './record/recorder.ts';
export type { RecorderHandle, RecorderOptions } from './record/recorder.ts';
export {
  createGoldenFile,
  parseGoldenFile,
  serializeGoldenFile,
  interactionKey,
  GOLDEN_FORMAT_VERSION,
} from './record/golden.ts';
export type { GoldenFile, GoldenInteraction } from './record/golden.ts';

export { compareGolden, HttpLiveSource, MockLiveSource, describeReport, summariseDifferences } from './diff/compare.ts';
export type { DiffReport, DiffSummary, InteractionDiff, LiveSource } from './diff/compare.ts';
export { diffJson, parseBody } from './diff/json-diff.ts';
export type { BodyDifference, DifferenceKind } from './diff/json-diff.ts';

export { renderTextReport, renderSummaryLine } from './report/text.ts';
export { renderJsonReport, buildJsonReport } from './report/json.ts';
export { renderHtmlReport } from './report/html.ts';
export { renderDiffReport } from './report/diff.ts';

export { parseYaml, YamlError } from './yaml/parser.ts';

export { TOOL_NAME, VERSION } from './version.ts';

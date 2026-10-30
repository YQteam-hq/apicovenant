import { serveMcp } from '../../mcp/server.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';

export interface McpCommandOptions {
  cwd?: string;
}

export async function runMcp(options: McpCommandOptions = {}): Promise<number> {
  process.stderr.write(`${TOOL_NAME} ${VERSION} — Model Context Protocol server on stdio\n`);

  await serveMcp({
    input: process.stdin,
    write: (line) => {
      process.stdout.write(line);
    },
    log: (message) => {
      process.stderr.write(`${message}\n`);
    },
    cwd: options.cwd ?? process.cwd(),
  });

  return 0;
}

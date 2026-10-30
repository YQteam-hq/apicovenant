import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function readTextFile(filePath: string): Promise<string> {
  // Validate file path to prevent directory traversal attacks
  const resolvedPath = path.resolve(filePath);
  const allowedDir = path.resolve(process.cwd(), 'output');
  if (!resolvedPath.startsWith(allowedDir)) {
    throw new Error('Access denied: outside allowed directory');
  }
  return fs.readFile(resolvedPath, 'utf8');
}

export async function writeTextFile(filePath: string, contents: string): Promise<void> {
  // Validate file path to prevent directory traversal attacks
  const resolvedPath = path.resolve(filePath);
  const allowedDir = path.resolve(process.cwd(), 'output');
  if (!resolvedPath.startsWith(allowedDir)) {
    throw new Error('Access denied: outside allowed directory');
  }
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, contents, 'utf8');
}

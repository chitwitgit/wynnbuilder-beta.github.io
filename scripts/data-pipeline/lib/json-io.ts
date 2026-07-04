import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** Match Python json.dump default ensure_ascii=True (non-ASCII → \\uXXXX). */
function escapeNonAscii(json: string): string {
  return json.replace(/[\u0080-\uFFFF]/g, (char) => {
    const code = char.charCodeAt(0);
    return '\\u' + code.toString(16).padStart(4, '0');
  });
}

export function writeJsonMinified(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data), 'utf-8');
}

export function writeJsonPretty(path: string, data: unknown, indent = 2): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, escapeNonAscii(JSON.stringify(data, null, indent)), 'utf-8');
}

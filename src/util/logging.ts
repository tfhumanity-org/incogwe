/**
 * A logger that will not accept raw personal data.
 *
 * `log.info(msg, fields)` always passes `fields` through `redact()`. There is no
 * escape hatch, deliberately: a developer who wants to see a subject's real name
 * must use a debugger, not a log line that could end up in a log aggregator.
 */
import { redact } from './redact.ts';

export type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = (process.env.DELETEWE_LOG_LEVEL as Level) ?? 'info';
let sink: (line: string) => void = (line) => process.stdout.write(line + '\n');

export function setLevel(l: Level): void { threshold = l; }
export function setSink(fn: (line: string) => void): void { sink = fn; }

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  sink(JSON.stringify(record));
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
};

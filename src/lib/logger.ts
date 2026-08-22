import { writeSync } from 'node:fs';

type LogFields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', message: string, fields?: LogFields): void {
  const line = { time: new Date().toISOString(), level, message, ...fields };
  const stream = level === 'error' ? console.error : console.log;
  stream(JSON.stringify(line));
}

/** Structured single-line JSON, which is what Railway's log viewer indexes best. */
export const logger = {
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};

/**
 * `console.error` writes to a pipe asynchronously, and a container's stderr is
 * always a pipe — so a line logged immediately before `process.exit` can be
 * dropped, taking the reason for the exit with it. Anything fatal goes straight
 * to the file descriptor instead, which is synchronous and cannot be truncated.
 */
export function logFatal(message: string, fields?: LogFields): void {
  const line = { time: new Date().toISOString(), level: 'error', message, ...fields };
  writeSync(2, `${JSON.stringify(line)}\n`);
}

export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

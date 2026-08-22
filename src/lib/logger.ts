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

export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

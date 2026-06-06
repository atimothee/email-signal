/* Lightweight logger that prefixes everything with [EmailSignal]. */
const prefix = '[EmailSignal]';

export const log = {
  debug: (...a: unknown[]) => console.debug(prefix, ...a),
  info: (...a: unknown[]) => console.log(prefix, ...a),
  warn: (...a: unknown[]) => console.warn(prefix, ...a),
  error: (...a: unknown[]) => console.error(prefix, ...a),
};

// Single import point for all EmailSignal data contracts.
// Every agent boundary, tool boundary, message-bus boundary, and storage
// adapter MUST validate against these schemas — never trust unvalidated data
// flowing in from the DOM, LLM output, or another extension surface.

export * from './email.js';
export * from './clutter.js';
export * from './priority.js';
export * from './decision.js';
export * from './action.js';
export * from './memory.js';
export * from './brief.js';
export * from './trace.js';
export * from './identity.js';
export * from './messaging.js';

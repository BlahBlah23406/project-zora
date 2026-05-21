/**
 * emitter.js — shared event bus for internal observability.
 * ollama.js emits here; server.js listens and forwards to SSE clients.
 */
const { EventEmitter } = require('events');
module.exports = new EventEmitter();

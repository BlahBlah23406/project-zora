'use strict';

const _store = {};

function set(key, value, ttlSeconds) {
  if (!ttlSeconds || ttlSeconds <= 0) return;
  _store[key] = { value, expires: Date.now() + ttlSeconds * 1000 };
}

function get(key) {
  const entry = _store[key];
  if (!entry) return null;
  if (Date.now() > entry.expires) { delete _store[key]; return null; }
  return entry.value;
}

function invalidate(key) {
  delete _store[key];
}

function flush() {
  for (const key of Object.keys(_store)) delete _store[key];
}

module.exports = { set, get, invalidate, flush };

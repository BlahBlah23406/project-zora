/**
 * cache.js
 * Simple in-memory TTL cache used by all Google API connectors.
 * Keys are plain strings; values are arbitrary JS objects.
 *
 * TTLs used across the app (seconds):
 *   google_calendar : 7200   (2 hours)
 *   google_tasks    : 1800   (30 minutes)
 *   gmail_summary   : 86400  (1 day)
 *   ical_feeds      : 14400  (4 hours)
 *   ollama_plan     : 3600   (1 hour)
 *   master_context  : 0      (never cache — always read from file)
 */

const _store = {};

/**
 * Store a value with a TTL.
 * @param {string} key
 * @param {*} value
 * @param {number} ttlSeconds — 0 means "never cache" (no-op)
 */
function set(key, value, ttlSeconds) {
  if (!ttlSeconds || ttlSeconds <= 0) return;
  _store[key] = { value, expires: Date.now() + ttlSeconds * 1000 };
}

/**
 * Retrieve a cached value.
 * Returns null if missing or expired.
 * @param {string} key
 * @returns {* | null}
 */
function get(key) {
  const entry = _store[key];
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    delete _store[key];
    return null;
  }
  return entry.value;
}

/**
 * Remove a cached value immediately.
 * @param {string} key
 */
function invalidate(key) {
  delete _store[key];
}

/**
 * Clear all cached entries.
 */
function flush() {
  for (const key of Object.keys(_store)) delete _store[key];
}

module.exports = { set, get, invalidate, flush };

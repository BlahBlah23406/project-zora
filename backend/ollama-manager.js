/**
 * ollama-manager.js
 * Manages the Ollama process lifecycle — start on app launch, stop on quit.
 * Uses the native http module to probe localhost:11434 before spawning.
 */

const { spawn } = require('child_process');
const http = require('http');

let ollamaProcess = null;

/**
 * Probe Ollama's /api/version endpoint.
 * Returns true if it responds 200, false otherwise.
 */
function isOllamaRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:11434/api/version', (res) => {
      resolve(res.statusCode === 200);
      res.resume(); // drain
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Poll until Ollama is ready or we exhaust retries.
 */
async function waitForOllama(retries = 15, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    if (await isOllamaRunning()) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('[ollama] Timed out waiting for Ollama to become ready');
}

/**
 * Start Ollama if it isn't already running.
 * Registers a process-exit hook to clean up the child process.
 */
async function startOllama() {
  if (await isOllamaRunning()) {
    console.log('[ollama] Already running — skipping launch');
    return;
  }

  console.log('[ollama] Spawning `ollama serve`...');
  ollamaProcess = spawn('ollama', ['serve'], {
    detached: false,
    stdio: 'ignore',
  });

  ollamaProcess.on('error', (err) => {
    console.error('[ollama] Spawn error:', err.message);
    console.error('         Make sure Ollama is installed: https://ollama.com');
  });

  ollamaProcess.on('exit', (code, signal) => {
    if (code !== null) console.log(`[ollama] Exited with code ${code}`);
    if (signal !== null) console.log(`[ollama] Killed by signal ${signal}`);
    ollamaProcess = null;
  });

  await waitForOllama();
  console.log('[ollama] Ready');
}

/**
 * Gracefully stop the Ollama child process we spawned.
 * Does nothing if Ollama was already running before app start.
 */
function stopOllama() {
  if (ollamaProcess) {
    console.log('[ollama] Stopping child process...');
    ollamaProcess.kill('SIGTERM');
    ollamaProcess = null;
  }
}

module.exports = { startOllama, stopOllama, isOllamaRunning };

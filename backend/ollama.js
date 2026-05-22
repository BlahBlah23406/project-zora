'use strict';

require('dotenv').config();
const http    = require('http');
const https   = require('https');
const emitter = require('./emitter');

const OLLAMA_HOST        = process.env.OLLAMA_HOST        || 'http://localhost:11434';
const OLLAMA_MODEL       = process.env.OLLAMA_MODEL       || 'deepseek-r1:7b';
const OLLAMA_JSON_MODEL  = process.env.OLLAMA_JSON_MODEL  || 'qwen2.5:3b';
const OLLAMA_AUDIT_MODEL = process.env.OLLAMA_AUDIT_MODEL || OLLAMA_MODEL;
const OLLAMA_API_KEY     = process.env.OLLAMA_API_KEY     || '';

function httpPost(pathname, body, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    const bodyStr   = JSON.stringify(body);
    const urlObj    = new URL(`${OLLAMA_HOST}${pathname}`);
    const isHttps   = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    };
    if (OLLAMA_API_KEY) headers['Authorization'] = `Bearer ${OLLAMA_API_KEY}`;

    const reqOpts = {
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || (isHttps ? 443 : 11434),
      path:     urlObj.pathname,
      method:   'POST',
      headers,
    };

    const req = transport.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200)
          return reject(new Error(`[ollama] HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`[ollama] Bad JSON: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`[ollama] ${e.message}`)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`[ollama] Timed out after ${timeoutMs / 1000}s`));
    });
    req.write(bodyStr);
    req.end();
  });
}

function stripThinkTags(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .trim();
}

function extractThinkText(text) {
  if (!text) return '';
  const matches = [...text.matchAll(/<think>([\s\S]*?)<\/think>/gi)];
  if (matches.length > 0) {
    return matches.map((m) => m[1].trim()).filter(Boolean).join('\n\n').trim();
  }
  const openIdx = text.search(/<think>/i);
  if (openIdx !== -1) return text.slice(openIdx + 7).trim();
  return '';
}

// Robustly extract the first complete JSON object or array from a string using
// balanced-bracket matching, so trailing model commentary doesn't corrupt the result.
function extractJSON(text) {
  if (!text) return null;
  const open  = text.indexOf('{') === -1 ? Infinity : text.indexOf('{');
  const openA = text.indexOf('[') === -1 ? Infinity : text.indexOf('[');
  const start = Math.min(open, openA);
  if (start === Infinity) return null;

  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth    = 0;
  let inString = false;
  let escape   = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape)                { escape = false; continue; }
    if (c === '\\' && inString) { escape = true;  continue; }
    if (c === '"')              { inString = !inString; continue; }
    if (inString)               { continue; }
    if (c === opener)           { depth++; }
    else if (c === closer) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function generate({ model = OLLAMA_MODEL, system = '', prompt, options = {} }) {
  emitter.emit('ollama:prompt', { mode: 'generate', model, system, prompt });
  const finalOptions = { temperature: 0.5, num_ctx: 16384, num_predict: 6000, ...options };

  const data = await httpPost('/api/generate', {
    model,
    system,
    prompt,
    stream:  false,
    options: finalOptions,
  });
  const rawResponse = data.response || '';
  const response    = stripThinkTags(rawResponse);
  const thinking    = extractThinkText(rawResponse);
  emitter.emit('ollama:response', { mode: 'generate', model, response, thinking, rawResponse });
  return response;
}

async function chat({ model = OLLAMA_MODEL, system = '', messages = [], options = {} }) {
  const fullMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : [...messages];

  emitter.emit('ollama:prompt', { mode: 'chat', model, system, messages });
  const finalOptions = { temperature: 0.6, num_ctx: 16384, num_predict: 6000, ...options };

  const data = await httpPost('/api/chat', {
    model,
    messages: fullMessages,
    stream:   false,
    options:  finalOptions,
  });

  const content  = data.message?.content || '';
  const response = stripThinkTags(content);
  const thinking = extractThinkText(content);
  emitter.emit('ollama:response', { mode: 'chat', model, response, thinking, rawResponse: content });
  return response;
}

function generateStream({ model = OLLAMA_MODEL, system = '', prompt, options = {} }, onToken) {
  emitter.emit('ollama:prompt', { mode: 'stream', model, system, prompt });
  return new Promise((resolve, reject) => {
    const finalOptions = { temperature: 0.65, num_ctx: 16384, num_predict: 6000, ...options };

    const body      = JSON.stringify({ model, system, prompt, stream: true, options: finalOptions });
    const urlObj    = new URL(`${OLLAMA_HOST}/api/generate`);
    const isHttps   = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;

    const streamHeaders = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (OLLAMA_API_KEY) streamHeaders['Authorization'] = `Bearer ${OLLAMA_API_KEY}`;

    const reqOpts = {
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || (isHttps ? 443 : 11434),
      path:     urlObj.pathname,
      method:   'POST',
      headers:  streamHeaders,
    };

    let fullText   = '';
    let lineBuffer = '';
    let inThink    = false;
    let thinkBuf   = '';

    const req = transport.request(reqOpts, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', (c) => (errData += c));
        res.on('end', () =>
          reject(new Error(`[ollama/stream] HTTP ${res.statusCode}: ${errData.slice(0, 200)}`))
        );
        return;
      }

      res.on('data', (chunk) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer  = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }

          const token = obj.response || '';
          if (!token) continue;

          if (inThink) {
            thinkBuf += token;
            const closeIdx = thinkBuf.indexOf('</think>');
            if (closeIdx !== -1) {
              inThink  = false;
              thinkBuf = '';
              const after = token.slice(token.indexOf('</think>') + 8);
              if (after) { fullText += after; onToken(after); }
            }
          } else {
            const openIdx = token.indexOf('<think>');
            if (openIdx !== -1) {
              const before = token.slice(0, openIdx);
              if (before) { fullText += before; onToken(before); }
              inThink  = true;
              thinkBuf = token.slice(openIdx + 7);
              const closeIdx = thinkBuf.indexOf('</think>');
              if (closeIdx !== -1) { inThink = false; thinkBuf = ''; }
            } else {
              fullText += token;
              onToken(token);
            }
          }
        }
      });

      res.on('end', () => {
        const result = fullText.trim();
        emitter.emit('ollama:response', { mode: 'stream', model, response: result });
        resolve(result);
      });
    });

    req.on('error', (e) => reject(new Error(`[ollama/stream] ${e.message}`)));
    req.setTimeout(240_000, () => {
      req.destroy();
      reject(new Error('[ollama/stream] Timed out'));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { generate, chat, generateStream, extractJSON, OLLAMA_HOST, OLLAMA_MODEL, OLLAMA_JSON_MODEL, OLLAMA_AUDIT_MODEL };

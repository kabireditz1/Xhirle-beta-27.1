import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4173;
const HOST = '0.0.0.0';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw || '{}');
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function endpointUrl(value, fallback) {
  let url;
  try {
    url = new URL(String(value || fallback || '').trim());
  } catch {
    throw new Error('Enter a valid API endpoint URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('API endpoint must start with https:// or http://.');
  }
  return url;
}

function isLocalUrl(url) {
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

function checkCredentials(url, apiKey) {
  if (!apiKey && !isLocalUrl(url)) {
    throw new Error('Add the API key issued by this provider. Local endpoints such as Ollama can be used without a key.');
  }
}

function joinPath(pathname, suffix) {
  const left = (pathname || '').replace(/\/+$/, '');
  return `${left}${suffix}` || '/';
}

function openAIEndpoint(input) {
  const url = endpointUrl(input, 'https://api.openai.com/v1');
  const pathName = url.pathname.replace(/\/+$/, '');
  if (!/\/chat\/completions$/i.test(pathName)) {
    if (/\/v\d+(?:beta)?$/i.test(pathName)) {
      url.pathname = joinPath(pathName, '/chat/completions');
    } else {
      url.pathname = joinPath(pathName, '/v1/chat/completions');
    }
  }
  return url;
}

function anthropicEndpoint(input) {
  const url = endpointUrl(input, 'https://api.anthropic.com');
  const pathName = url.pathname.replace(/\/+$/, '');
  if (!/\/v\d+\/messages$/i.test(pathName)) {
    if (/\/v\d+$/i.test(pathName)) {
      url.pathname = joinPath(pathName, '/messages');
    } else {
      url.pathname = joinPath(pathName, '/v1/messages');
    }
  }
  return url;
}

function geminiEndpoint(input, model, stream, apiKey) {
  const url = endpointUrl(input, 'https://generativelanguage.googleapis.com');
  const pathName = url.pathname.replace(/\/+$/, '');
  if (!/\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/i.test(pathName)) {
    const cleanModel = String(model).replace(/^models\//i, '');
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    if (/\/v1beta$/i.test(pathName)) {
      url.pathname = joinPath(pathName, `/models/${encodeURIComponent(cleanModel)}:${action}`);
    } else {
      url.pathname = joinPath(pathName, `/v1beta/models/${encodeURIComponent(cleanModel)}:${action}`);
    }
  }
  if (stream) url.searchParams.set('alt', 'sse');
  if (apiKey) url.searchParams.set('key', apiKey);
  return url;
}

function cleanMessages(value) {
  if (!Array.isArray(value)) throw new Error('Chat messages are missing.');
  return value.slice(-100).map((item) => {
    const role = item?.role;
    if (!['user', 'assistant', 'system'].includes(role)) return null;
    return { role, content: String(item?.content ?? '').slice(0, 100_000) };
  }).filter(Boolean).filter((item) => item.content.length > 0);
}

function buildUpstreamRequest(rawSettings, rawMessages, stream) {
  const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const provider = String(settings.provider || 'openai').toLowerCase();
  const model = String(settings.model || '').trim();
  const apiKey = String(settings.apiKey || '').trim();
  const systemPrompt = String(settings.systemPrompt || '').trim().slice(0, 12_000);
  const temperature = Math.max(0, Math.min(2, Number(settings.temperature ?? 0.7)));
  const maxTokens = Math.max(1, Math.min(32_000, Math.round(Number(settings.maxTokens) || 2048)));

  if (!['openai', 'anthropic', 'gemini'].includes(provider)) {
    throw new Error('Choose a supported API protocol.');
  }
  if (!model) throw new Error('Enter a model ID in Settings.');

  const messages = cleanMessages(rawMessages);
  const endpoint = String(settings.endpoint || '').trim();

  if (provider === 'openai') {
    const url = openAIEndpoint(endpoint);
    checkCredentials(url, apiKey);
    const promptMessages = [];
    if (systemPrompt) promptMessages.push({ role: 'system', content: systemPrompt });
    for (const message of messages) {
      if (message.role !== 'system') promptMessages.push({ role: message.role, content: message.content });
    }
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return {
      url,
      options: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: promptMessages,
          stream,
          temperature: Number.isFinite(temperature) ? temperature : 0.7,
          max_tokens: maxTokens,
        }),
      },
    };
  }

  if (provider === 'anthropic') {
    const url = anthropicEndpoint(endpoint);
    checkCredentials(url, apiKey);
    const systemParts = [systemPrompt, ...messages.filter((item) => item.role === 'system').map((item) => item.content)].filter(Boolean);
    const promptMessages = messages.filter((item) => item.role !== 'system').map((item) => ({ role: item.role, content: item.content }));
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (apiKey) headers['x-api-key'] = apiKey;
    return {
      url,
      options: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: Math.min(1, Number.isFinite(temperature) ? temperature : 0.7),
          stream,
          ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
          messages: promptMessages,
        }),
      },
    };
  }

  const url = geminiEndpoint(endpoint, model, stream, apiKey);
  checkCredentials(url, apiKey);
  const systemParts = [systemPrompt, ...messages.filter((item) => item.role === 'system').map((item) => item.content)].filter(Boolean);
  const contents = messages.filter((item) => item.role !== 'system').map((item) => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.content }],
  }));
  return {
    url,
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(systemParts.length ? { systemInstruction: { parts: [{ text: systemParts.join('\n\n') }] } } : {}),
        contents,
        generationConfig: {
          temperature: Number.isFinite(temperature) ? temperature : 0.7,
          maxOutputTokens: maxTokens,
        },
      }),
    },
  };
}

function getText(provider, payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (provider === 'openai') {
    const content = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part) => part?.text || '').join('');
    return '';
  }
  if (provider === 'anthropic') {
    if (payload.type === 'content_block_delta' && typeof payload.delta?.text === 'string') return payload.delta.text;
    if (Array.isArray(payload.content)) return payload.content.map((part) => part?.text || '').join('');
    return '';
  }
  const parts = payload.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((part) => part?.text || '').join('');
  return '';
}

function errorMessageFromBody(raw, apiKey) {
  let message = String(raw || '').trim();
  try {
    const parsed = JSON.parse(message);
    message = parsed?.error?.message || parsed?.error?.details?.[0]?.message || parsed?.message || message;
  } catch {
    // Keep the plain-text provider response for useful diagnostics.
  }
  if (apiKey) message = message.split(apiKey).join('[redacted]');
  return (message || 'The provider returned an empty error response.').slice(0, 1400);
}

async function readProviderError(response, apiKey) {
  let text = '';
  try { text = await response.text(); } catch { /* Ignore a closed upstream body. */ }
  return errorMessageFromBody(text, apiKey);
}

function writeSse(res, payload) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function forwardProviderStream(provider, upstream, res) {
  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    const text = await upstream.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = null; }
    const answer = getText(provider, payload);
    if (answer) writeSse(res, { token: answer });
    return;
  }

  if (!upstream.body) return;
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const payload = JSON.parse(data);
      const token = getText(provider, payload);
      if (token) writeSse(res, { token });
      if (payload?.error?.message) writeSse(res, { error: String(payload.error.message).slice(0, 1000) });
    } catch {
      // Ignore non-JSON SSE comments and provider keep-alive frames.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    if (done) break;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) processLine(line);
  }
  buffer += decoder.decode();
  if (buffer) processLine(buffer);
}

async function handleChat(req, res) {
  const body = await readJson(req);
  const settings = body.settings || {};
  const messages = cleanMessages(body.messages);
  const provider = String(settings.provider || 'openai').toLowerCase();
  const apiKey = String(settings.apiKey || '').trim();
  const upstreamRequest = buildUpstreamRequest(settings, messages, true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  let upstream;
  try {
    upstream = await fetch(upstreamRequest.url, { ...upstreamRequest.options, signal: controller.signal });
  } catch (error) {
    clearTimeout(timeout);
    if (res.writableEnded) return;
    const reason = error?.name === 'AbortError' ? 'The request was cancelled or timed out.' : `Could not reach the provider. ${error?.cause?.message || error?.message || ''}`.trim();
    sendJson(res, 502, { error: reason });
    return;
  }

  if (!upstream.ok) {
    const message = await readProviderError(upstream, apiKey);
    clearTimeout(timeout);
    sendJson(res, upstream.status || 502, { error: message, providerStatus: upstream.status });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  try {
    await forwardProviderStream(provider, upstream, res);
    writeSse(res, { done: true });
  } catch (error) {
    if (!controller.signal.aborted) writeSse(res, { error: `Stream interrupted: ${error?.message || 'unknown error'}` });
  } finally {
    clearTimeout(timeout);
    if (!res.writableEnded) res.end();
  }
}

async function handleTest(req, res) {
  const body = await readJson(req);
  const settings = body.settings || {};
  const provider = String(settings.provider || 'openai').toLowerCase();
  const apiKey = String(settings.apiKey || '').trim();
  const upstreamRequest = buildUpstreamRequest(settings, [{ role: 'user', content: 'Reply with exactly: Xhirlie connection test successful.' }], false);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let upstream;
  try {
    upstream = await fetch(upstreamRequest.url, { ...upstreamRequest.options, signal: controller.signal });
  } catch (error) {
    clearTimeout(timeout);
    const reason = error?.name === 'AbortError' ? 'The test request timed out.' : `Could not reach the provider. ${error?.cause?.message || error?.message || ''}`.trim();
    sendJson(res, 502, { error: reason });
    return;
  }
  clearTimeout(timeout);
  if (!upstream.ok) {
    const message = await readProviderError(upstream, apiKey);
    sendJson(res, upstream.status || 502, { error: message, providerStatus: upstream.status });
    return;
  }
  let preview = '';
  try {
    const payload = await upstream.json();
    preview = getText(provider, payload).slice(0, 240);
  } catch {
    // A successful non-JSON response still confirms reachability; the UI will note it.
  }
  sendJson(res, 200, { ok: true, preview });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try { decoded = decodeURIComponent(requested); } catch { sendJson(res, 400, { error: 'Invalid path.' }); return; }
  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    sendJson(res, 403, { error: 'Forbidden.' });
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ['.html', '.css', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, app: 'Xhirlie beta 27' });
    return;
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/chat') {
    handleChat(req, res).catch((error) => sendJson(res, error.status || 400, { error: error.message || 'Could not start the chat request.' }));
    return;
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/test') {
    handleTest(req, res).catch((error) => sendJson(res, error.status || 400, { error: error.message || 'Could not test this connection.' }));
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && !requestUrl.pathname.startsWith('/api/')) {
    serveStatic(req, res, requestUrl.pathname);
    return;
  }
  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`Xhirlie beta 27 is running at http://${HOST}:${PORT}`);
});

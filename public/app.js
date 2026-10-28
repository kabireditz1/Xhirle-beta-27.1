const SETTINGS_STORAGE_KEY = 'xhirlie.settings.v1';
const CHATS_STORAGE_KEY = 'xhirlie.chats.v1';
const THEME_STORAGE_KEY = 'xhirlie.theme.v1';

const DEFAULT_SYSTEM_PROMPT = 'You are Xhirlie beta 27, a helpful, thoughtful AI assistant. Be clear, accurate, and natural. If the user writes in Bengali or Banglish, respond in the language they used.';
const DEFAULT_SETTINGS = {
  provider: 'openai',
  preset: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  rememberKey: false,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.7,
  maxTokens: 2048,
};

const PRESETS = {
  openai: { label: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq: { label: 'Groq', endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  together: { label: 'Together AI', endpoint: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  mistral: { label: 'Mistral', endpoint: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  xai: { label: 'xAI', endpoint: 'https://api.x.ai/v1', model: 'grok-3-mini' },
  ollama: { label: 'Ollama · local', endpoint: 'http://localhost:11434/v1', model: 'llama3.2' },
  lmstudio: { label: 'LM Studio · local', endpoint: 'http://localhost:1234/v1', model: 'local-model' },
  custom: { label: 'Custom endpoint', endpoint: '', model: '' },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function readStoredSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    if (!merged.rememberKey) merged.apiKey = '';
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function readStoredChats() {
  try {
    const value = JSON.parse(localStorage.getItem(CHATS_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages)).map((item) => ({
      id: item.id,
      title: String(item.title || 'New chat'),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
      messages: item.messages.filter((message) => message && ['user', 'assistant'].includes(message.role)).map((message) => ({
        id: String(message.id || makeId()),
        role: message.role,
        content: String(message.content || ''),
        error: Boolean(message.error),
        stopped: Boolean(message.stopped),
      })),
    }));
  } catch {
    return [];
  }
}

let settings = readStoredSettings();
let conversations = readStoredChats();
let currentConversationId = conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id || null;
let activeController = null;
let isGenerating = false;
let toastTimeout = null;
let settingsReturnFocus = null;
let serverConfig = { serverKeys: {}, defaults: {} };

const chatList = $('#chat-list');
const searchInput = $('#search-chats');
const welcomeView = $('#welcome-view');
const conversationView = $('#conversation-view');
const messagesElement = $('#messages');
const mainContent = $('#main-content');
const promptInput = $('#prompt-input');
const sendButton = $('#send-button');
const settingsBackdrop = $('#settings-backdrop');
const settingsForm = $('#settings-form');
const providerSelect = $('#provider-select');
const presetSelect = $('#preset-select');
const endpointInput = $('#endpoint-input');
const modelInput = $('#model-input');
const apiKeyInput = $('#api-key-input');
const rememberKeyInput = $('#remember-key');
const systemPromptInput = $('#system-prompt-input');
const temperatureInput = $('#temperature-input');
const maxTokensInput = $('#max-tokens-input');

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function isLocalEndpoint(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

function hasServerKey(settingsValue = settings) {
  return Boolean(serverConfig.serverKeys?.[settingsValue.provider]);
}

function hasConnection(settingsValue = settings) {
  if (String(settingsValue.apiKey || '').trim()) return true;
  if (hasServerKey(settingsValue)) return true;
  return settingsValue.provider === 'openai' && isLocalEndpoint(settingsValue.endpoint);
}

function updateHeader() {
  $('#welcome-settings').classList.toggle('hidden', hasConnection());
}

function saveSettings() {
  const stored = { ...settings };
  if (!stored.rememberKey) delete stored.apiKey;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    showToast('Browser storage is full. Your current settings will work until you close this page.');
  }
  updateHeader();
}

function saveConversations() {
  conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  conversations = conversations.slice(0, 80);
  try {
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    showToast('Could not save this chat in browser storage.');
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3200);
}

function titleFromPrompt(prompt) {
  const cleaned = String(prompt).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 42) return cleaned || 'New chat';
  return `${cleaned.slice(0, 39).trimEnd()}…`;
}

function renderSidebar() {
  const query = searchInput.value.trim().toLowerCase();
  const items = conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt).filter((conversation) => {
    if (!query) return true;
    return conversation.title.toLowerCase().includes(query) || conversation.messages.some((message) => message.content.toLowerCase().includes(query));
  });
  if (!items.length) {
    chatList.innerHTML = `<div class="chat-list-empty">${query ? 'No chats match that search.' : 'Your conversations will appear here.'}</div>`;
    return;
  }
  const chatIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.6-3.3A7.5 7.5 0 1 1 20 11.5Z"/><path d="M9 11.5h6"/></svg>';
  const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6.5 7l.8 13h9.4l.8-13M9 7V4h6v3"/></svg>';
  chatList.innerHTML = items.map((conversation) => `
    <div class="chat-item ${conversation.id === currentConversationId ? 'active' : ''}" data-id="${escapeHtml(conversation.id)}">
      <button class="chat-item-select" type="button" data-action="select" data-id="${escapeHtml(conversation.id)}" title="${escapeHtml(conversation.title)}">
        <span class="chat-item-icon">${chatIcon}</span><span class="chat-title">${escapeHtml(conversation.title)}</span>
      </button>
      <button class="delete-chat" type="button" data-action="delete" data-id="${escapeHtml(conversation.id)}" aria-label="Delete ${escapeHtml(conversation.title)}" title="Delete chat">${trashIcon}</button>
    </div>`).join('');
}

function inlineMarkdown(value) {
  let result = escapeHtml(value);
  const codeParts = [];
  result = result.replace(/`([^`\n]+)`/g, (_, code) => {
    const index = codeParts.push(code) - 1;
    return `\uE000${index}\uE001`;
  });
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
  result = result.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  result = result.replace(/\uE000(\d+)\uE001/g, (_, index) => `<code>${codeParts[Number(index)] || ''}</code>`);
  return result;
}

function renderPlainMarkdown(value) {
  const blocks = value.trim().split(/\n{2,}/).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.length === 1) {
      const heading = lines[0].match(/^(#{1,3})\s+(.+)$/);
      if (heading) return `<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`;
    }
    if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^\s*[-*+]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
      return `<ol>${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    }
    if (lines.every((line) => /^\s*&gt;\s?/.test(escapeHtml(line)))) {
      return `<blockquote>${lines.map((line) => inlineMarkdown(line.replace(/^\s*>\s?/, ''))).join('<br>')}</blockquote>`;
    }
    return `<p>${lines.map(inlineMarkdown).join('<br>')}</p>`;
  }).join('');
}

function renderMarkdown(source) {
  const text = String(source || '').replace(/\r\n?/g, '\n');
  const fence = /```([a-zA-Z0-9_+#.-]*)[ \t]*\n([\s\S]*?)```/g;
  let output = '';
  let cursor = 0;
  let match;
  while ((match = fence.exec(text)) !== null) {
    output += renderPlainMarkdown(text.slice(cursor, match.index));
    const language = match[1] ? `<span class="code-language">${escapeHtml(match[1])}</span>` : '';
    output += `<pre>${language}<code>${escapeHtml(match[2].replace(/\n$/, ''))}</code></pre>`;
    cursor = match.index + match[0].length;
  }
  output += renderPlainMarkdown(text.slice(cursor));
  return output;
}

function assistantLogo() {
  return '<img class="avatar-logo" src="/xhirlie-logo.png" alt="" />';
}

function renderMessage(message, index, conversation) {
  if (message.role === 'user') {
    return `<article class="message-row user" data-index="${index}">
      <div class="message-body"><div class="message-meta"><span class="message-author">You</span></div>
      <div class="message-content user-content">${escapeHtml(message.content)}</div></div>
    </article>`;
  }
  const isCurrentStreaming = isGenerating && conversation.id === currentConversationId && index === conversation.messages.length - 1 && !message.content;
  const isCurrentLast = isGenerating && conversation.id === currentConversationId && index === conversation.messages.length - 1;
  const body = message.content
    ? renderMarkdown(message.content) + (isCurrentLast ? '<span class="stream-cursor" aria-hidden="true"></span>' : '')
    : isCurrentStreaming ? '<span class="typing-dots" aria-label="Xhirlie is thinking"><i></i><i></i><i></i></span>' : '';
  return `<article class="message-row assistant" data-index="${index}">
    <div class="message-avatar">${assistantLogo()}</div>
    <div class="message-body">
      <div class="message-meta"><span class="message-author">Xhirlie beta 27</span></div>
      <div class="message-content markdown ${message.error ? 'message-error' : ''}">${body}</div>
      ${!isCurrentLast ? `<div class="message-tools">
        ${message.content ? `<button class="message-tool" type="button" data-action="copy" data-index="${index}" aria-label="Copy response"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></svg>Copy</button>` : ''}
        <button class="message-tool" type="button" data-action="regenerate" data-index="${index}" aria-label="Regenerate response"><svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.7 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.3-3"/></svg>Retry</button>
      </div>` : ''}
    </div>
  </article>`;
}

function renderConversation(shouldScroll = false) {
  const conversation = conversations.find((item) => item.id === currentConversationId);
  const hasMessages = Boolean(conversation?.messages?.length);
  welcomeView.classList.toggle('hidden', hasMessages);
  conversationView.classList.toggle('hidden', !hasMessages);
  if (!hasMessages) {
    messagesElement.innerHTML = '';
    renderSidebar();
    return;
  }
  messagesElement.innerHTML = conversation.messages.map((message, index) => renderMessage(message, index, conversation)).join('');
  renderSidebar();
  if (shouldScroll) requestAnimationFrame(() => { mainContent.scrollTop = mainContent.scrollHeight; });
}

function openSidebar() { document.body.classList.add('sidebar-open'); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); }

function startNewChat() {
  if (isGenerating && activeController) activeController.abort();
  currentConversationId = null;
  closeSidebar();
  mainContent.scrollTop = 0;
  renderConversation();
  promptInput.value = '';
  resizePrompt();
  promptInput.focus({ preventScroll: true });
  updateSendButton();
}

function getFormSettings() {
  return {
    provider: providerSelect.value,
    preset: providerSelect.value === 'openai' ? presetSelect.value : providerSelect.value,
    endpoint: endpointInput.value.trim(),
    model: modelInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    rememberKey: rememberKeyInput.checked,
    systemPrompt: systemPromptInput.value.trim(),
    temperature: Number(temperatureInput.value),
    maxTokens: Math.max(64, Math.min(32000, Number(maxTokensInput.value) || 2048)),
  };
}

function populateSettingsForm() {
  providerSelect.value = settings.provider || 'openai';
  presetSelect.value = PRESETS[settings.preset] ? settings.preset : 'custom';
  endpointInput.value = settings.endpoint || '';
  modelInput.value = settings.model || '';
  apiKeyInput.value = settings.apiKey || '';
  apiKeyInput.placeholder = hasServerKey() ? 'Using the server-side key — leave empty' : 'Paste the API key from your provider';
  rememberKeyInput.checked = Boolean(settings.rememberKey);
  systemPromptInput.value = settings.systemPrompt || '';
  temperatureInput.value = String(settings.temperature ?? 0.7);
  maxTokensInput.value = String(settings.maxTokens || 2048);
  $('#temperature-value').textContent = Number(temperatureInput.value).toFixed(1);
  $('#test-result').textContent = '';
  $('#test-result').className = 'test-result';
  $('#toggle-key').textContent = 'Show';
  apiKeyInput.type = 'password';
  updateProtocolFields();
}

function updateProtocolFields() {
  const provider = providerSelect.value;
  const openai = provider === 'openai';
  $('#preset-row').classList.toggle('hidden', !openai);
  const endpointLabel = $('#endpoint-label');
  const endpointHelp = $('#endpoint-help');
  const keyOptional = $('#key-optional');
  if (openai) {
    endpointLabel.textContent = 'API base URL';
    endpointHelp.textContent = 'Use the provider’s OpenAI Chat Completions-compatible base URL. You can edit this for a custom endpoint.';
    keyOptional.textContent = hasServerKey({ provider: 'openai' })
      ? 'Server key active'
      : (presetSelect.value === 'ollama' || presetSelect.value === 'lmstudio' ? 'Optional for local endpoints' : 'Required for hosted APIs');
    endpointInput.placeholder = 'https://api.openai.com/v1';
    modelInput.placeholder = PRESETS[presetSelect.value]?.model || 'e.g. provider/model-id';
  } else if (provider === 'anthropic') {
    endpointLabel.textContent = 'API base URL';
    endpointHelp.textContent = 'Anthropic Messages API base. Default: https://api.anthropic.com';
    keyOptional.textContent = hasServerKey({ provider }) ? 'Server key active' : 'Required';
    endpointInput.placeholder = 'https://api.anthropic.com';
    modelInput.placeholder = 'Enter an enabled Anthropic model ID';
  } else {
    endpointLabel.textContent = 'API base URL';
    endpointHelp.textContent = 'Gemini API base. Default: https://generativelanguage.googleapis.com';
    keyOptional.textContent = hasServerKey({ provider }) ? 'Server key active' : 'Required';
    endpointInput.placeholder = 'https://generativelanguage.googleapis.com';
    modelInput.placeholder = 'Enter an enabled Gemini model ID';
  }
}

function openSettings() {
  settingsReturnFocus = document.activeElement;
  populateSettingsForm();
  settingsBackdrop.classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => providerSelect.focus(), 40);
}

function closeSettings() {
  settingsBackdrop.classList.add('hidden');
  document.body.classList.remove('modal-open');
  if (settingsReturnFocus?.focus) settingsReturnFocus.focus({ preventScroll: true });
}

function saveSettingsFromForm(event) {
  event.preventDefault();
  const next = getFormSettings();
  if (!next.model) {
    showToast('Enter the model ID you want to use.');
    modelInput.focus();
    return;
  }
  if (!next.endpoint) {
    showToast('Enter the API base URL for your provider.');
    endpointInput.focus();
    return;
  }
  settings = next;
  saveSettings();
  closeSettings();
  showToast('Your model settings are saved.');
}

async function testConnection() {
  const next = getFormSettings();
  const result = $('#test-result');
  const button = $('#test-connection');
  if (!next.model) {
    result.className = 'test-result error';
    result.textContent = 'Enter a model ID before testing.';
    modelInput.focus();
    return;
  }
  if (!next.endpoint) {
    result.className = 'test-result error';
    result.textContent = 'Enter an API base URL before testing.';
    endpointInput.focus();
    return;
  }
  button.disabled = true;
  button.classList.add('is-loading');
  $('.test-button-label', button).textContent = 'Testing…';
  result.className = 'test-result';
  result.textContent = '';
  try {
    const response = await fetch('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: next }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    result.className = 'test-result success';
    result.textContent = data.preview
      ? `Connection successful. Reply: “${data.preview}”`
      : 'Connection successful. The provider accepted the test request.';
  } catch (error) {
    result.className = 'test-result error';
    result.textContent = error.message || 'Could not connect. Check the endpoint, model ID, and key.';
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    $('.test-button-label', button).textContent = 'Test connection';
  }
}

function updateSendButton() {
  if (isGenerating) {
    sendButton.disabled = false;
    sendButton.classList.add('is-stop');
    sendButton.setAttribute('aria-label', 'Stop generating');
    sendButton.title = 'Stop generating';
  } else {
    sendButton.classList.remove('is-stop');
    sendButton.disabled = !promptInput.value.trim();
    sendButton.setAttribute('aria-label', 'Send message');
    sendButton.title = 'Send message';
  }
}

function resizePrompt() {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
  updateSendButton();
}

function canUseSettings(settingsValue) {
  return hasConnection(settingsValue);
}

function newConversation() {
  const conversation = {
    id: makeId(),
    title: 'New chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  conversations.unshift(conversation);
  currentConversationId = conversation.id;
  return conversation;
}

async function readEventStream(response, onToken) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text) onToken(text);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const processLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (event.error) throw new Error(event.error);
    if (event.token) onToken(String(event.token));
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

async function requestAssistant(conversation) {
  const currentSettings = { ...settings };
  if (!canUseSettings(currentSettings)) {
    openSettings();
    showToast('Add an API key to start. Local OpenAI-compatible models can run without one.');
    return;
  }
  const assistant = {
    id: makeId(),
    role: 'assistant',
    content: '',
    error: false,
    stopped: false,
  };
  conversation.messages.push(assistant);
  conversation.updatedAt = Date.now();
  isGenerating = true;
  activeController = new AbortController();
  updateSendButton();
  renderConversation(true);

  const requestMessages = conversation.messages
    .filter((message) => !message.error && message.content && ['user', 'assistant'].includes(message.role))
    .map(({ role, content }) => ({ role, content }));

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: currentSettings, messages: requestMessages }),
      signal: activeController.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `The request failed (${response.status}).`);
    }
    await readEventStream(response, (token) => {
      assistant.content += token;
      const nearBottom = mainContent.scrollHeight - mainContent.scrollTop - mainContent.clientHeight < 150;
      if (currentConversationId === conversation.id) renderConversation(nearBottom);
    });
    if (!assistant.content.trim()) assistant.content = 'The model returned an empty response. Check that this model supports chat completions.';
  } catch (error) {
    if (error.name === 'AbortError') {
      assistant.stopped = true;
      if (!assistant.content) assistant.content = 'Generation stopped.';
    } else {
      assistant.error = true;
      assistant.content = error.message || 'Could not connect to the model. Check your settings and try again.';
    }
  } finally {
    isGenerating = false;
    activeController = null;
    conversation.updatedAt = Date.now();
    saveConversations();
    updateHeader();
    updateSendButton();
    if (currentConversationId === conversation.id) renderConversation(true);
    else renderSidebar();
  }
}

async function sendMessage(text) {
  const content = String(text || '').trim();
  if (!content || isGenerating) return;
  if (!canUseSettings(settings)) {
    openSettings();
    showToast('Connect an API key in Settings before sending a message.');
    return;
  }
  let conversation = conversations.find((item) => item.id === currentConversationId);
  if (!conversation) conversation = newConversation();
  conversation.messages.push({ id: makeId(), role: 'user', content });
  if (conversation.title === 'New chat') conversation.title = titleFromPrompt(content);
  conversation.updatedAt = Date.now();
  promptInput.value = '';
  resizePrompt();
  saveConversations();
  renderConversation(true);
  closeSidebar();
  await requestAssistant(conversation);
}

function stopGeneration() {
  if (activeController) activeController.abort();
}

async function regenerateResponse(index) {
  if (isGenerating) return;
  const conversation = conversations.find((item) => item.id === currentConversationId);
  if (!conversation) return;
  let userIndex = -1;
  for (let position = Math.min(index, conversation.messages.length - 1); position >= 0; position -= 1) {
    if (conversation.messages[position].role === 'user') { userIndex = position; break; }
  }
  if (userIndex < 0) return;
  if (!canUseSettings(settings)) {
    openSettings();
    showToast('Connect an API key before retrying this response.');
    return;
  }
  conversation.messages = conversation.messages.slice(0, userIndex + 1);
  conversation.updatedAt = Date.now();
  saveConversations();
  renderConversation(true);
  await requestAssistant(conversation);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard.');
  } catch {
    const temporary = document.createElement('textarea');
    temporary.value = text;
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.appendChild(temporary);
    temporary.select();
    const success = document.execCommand('copy');
    temporary.remove();
    showToast(success ? 'Copied to clipboard.' : 'Could not copy this response.');
  }
}

function hasStoredSettings() {
  try {
    return Boolean(localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return false;
  }
}

async function loadServerConfig() {
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    serverConfig = {
      serverKeys: data?.serverKeys && typeof data.serverKeys === 'object' ? data.serverKeys : {},
      defaults: data?.defaults && typeof data.defaults === 'object' ? data.defaults : {},
    };
  } catch {
    return;
  }
  const { provider, model, endpoint } = serverConfig.defaults;
  if (hasStoredSettings() || !provider) return;
  settings = {
    ...settings,
    provider,
    preset: provider,
    endpoint: endpoint || settings.endpoint,
    model: model || settings.model,
  };
  updateHeader();
}

function applyTheme() {
  const dark = localStorage.getItem(THEME_STORAGE_KEY) !== 'light';
  document.body.classList.toggle('dark-mode', dark);
  updateHeader();
}

function setPreset(value, applyValues = true) {
  presetSelect.value = PRESETS[value] ? value : 'custom';
  if (applyValues) {
    const preset = PRESETS[presetSelect.value];
    if (preset) {
      endpointInput.value = preset.endpoint;
      if (preset.model) modelInput.value = preset.model;
    }
  }
  updateProtocolFields();
}

function bindEvents() {
  $('#new-chat').addEventListener('click', startNewChat);
  $('#brand-home').addEventListener('click', (event) => { event.preventDefault(); startNewChat(); });
  $('#open-settings').addEventListener('click', openSettings);
  $('#welcome-settings').addEventListener('click', openSettings);
  $('#close-settings').addEventListener('click', closeSettings);
  $('#cancel-settings').addEventListener('click', closeSettings);
  settingsBackdrop.addEventListener('click', (event) => { if (event.target === settingsBackdrop) closeSettings(); });
  settingsForm.addEventListener('submit', saveSettingsFromForm);
  $('#test-connection').addEventListener('click', testConnection);
  $('#mobile-menu').addEventListener('click', openSidebar);
  $('#sidebar-close').addEventListener('click', closeSidebar);
  $('#mobile-scrim').addEventListener('click', closeSidebar);
  searchInput.addEventListener('input', renderSidebar);

  providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value;
    if (provider === 'anthropic') {
      endpointInput.value = 'https://api.anthropic.com';
      modelInput.value = '';
    } else if (provider === 'gemini') {
      endpointInput.value = 'https://generativelanguage.googleapis.com';
      modelInput.value = '';
    } else {
      const preset = PRESETS[presetSelect.value] || PRESETS.openai;
      endpointInput.value = preset.endpoint || PRESETS.openai.endpoint;
      modelInput.value = preset.model || PRESETS.openai.model;
    }
    updateProtocolFields();
  });

  presetSelect.addEventListener('change', () => setPreset(presetSelect.value, true));
  endpointInput.addEventListener('input', () => {
    if (providerSelect.value === 'openai' && presetSelect.value !== 'custom') {
      presetSelect.value = 'custom';
      updateProtocolFields();
    }
  });
  $('#toggle-key').addEventListener('click', () => {
    const reveal = apiKeyInput.type === 'password';
    apiKeyInput.type = reveal ? 'text' : 'password';
    $('#toggle-key').textContent = reveal ? 'Hide' : 'Show';
    $('#toggle-key').setAttribute('aria-label', reveal ? 'Hide API key' : 'Show API key');
  });
  temperatureInput.addEventListener('input', () => { $('#temperature-value').textContent = Number(temperatureInput.value).toFixed(1); });

  $('#chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (isGenerating) stopGeneration();
    else sendMessage(promptInput.value);
  });
  promptInput.addEventListener('input', resizePrompt);
  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (isGenerating) stopGeneration();
      else sendMessage(promptInput.value);
    }
  });

  $$('.suggestion-card').forEach((button) => button.addEventListener('click', () => {
    promptInput.value = button.dataset.prompt || '';
    resizePrompt();
    promptInput.focus();
    promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
  }));

  chatList.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const id = target.dataset.id;
    const action = target.dataset.action;
    if (action === 'select') {
      currentConversationId = id;
      mainContent.scrollTop = mainContent.scrollHeight;
      renderConversation();
      closeSidebar();
    } else if (action === 'delete') {
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) return;
      if (!window.confirm(`Delete “${conversation.title}”?`)) return;
      if (currentConversationId === id && isGenerating && activeController) activeController.abort();
      conversations = conversations.filter((item) => item.id !== id);
      if (currentConversationId === id) currentConversationId = null;
      saveConversations();
      renderConversation();
      showToast('Conversation deleted.');
    }
  });

  messagesElement.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'copy') {
      const conversation = conversations.find((item) => item.id === currentConversationId);
      const message = conversation?.messages[Number(button.dataset.index)];
      if (message?.content) copyText(message.content);
    }
    if (button.dataset.action === 'regenerate') regenerateResponse(Number(button.dataset.index));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!settingsBackdrop.classList.contains('hidden')) closeSettings();
      else closeSidebar();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      startNewChat();
    }
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const target = event.target;
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      event.preventDefault();
      searchInput.focus();
    }
  });
}

async function initialize() {
  try { applyTheme(); } catch { updateHeader(); }
  bindEvents();
  await loadServerConfig();
  updateHeader();
  renderSidebar();
  renderConversation();
  resizePrompt();
  fetch('/api/health').catch(() => showToast('Xhirlie server could not be reached. Refresh the page or restart it.'));
}

initialize();

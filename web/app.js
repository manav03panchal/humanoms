import { html, render, useState, useEffect, useRef } from '/lib/preact.js';
import { api } from '/api.js';
import { ToastContainer, showToast } from '/components/toast.js';
import { MessageList, InputBar } from '/components/chat.js';
import { Dashboard } from '/components/dashboard.js';

const ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  logOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
};

function getInitialTheme() {
  const saved = localStorage.getItem('humanoms_theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return 'dark';
}

function LoginGate({ onLogin }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    api.setToken(key);
    try {
      await api.get('/api/v1/tasks');
      onLogin();
    } catch (err) {
      api.setToken(null);
      setError('Invalid API key');
    }
  }

  return html`
    <div class="login-gate">
      <div class="login-box">
        <h2>HumanOMS</h2>
        <p class="login-subtitle">Enter your API key to continue</p>
        <form onSubmit=${handleSubmit}>
          <input
            type="password"
            value=${key}
            onInput=${(e) => { setKey(e.target.value); setError(''); }}
            placeholder="API key"
            class="login-input"
            autofocus
          />
          ${error && html`<div class="login-error">${error}</div>`}
          <button type="submit" class="btn-primary login-btn">Login</button>
        </form>
      </div>
    </div>
  `;
}

function ChatView({ messages, setMessages, conversationId, setConversationId }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
  const [currentToolCalls, setCurrentToolCalls] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const abortRef = useRef(null);

  async function handleSend(text) {
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsStreaming(true);
    setCurrentAssistantMessage('');
    setCurrentToolCalls([]);
    setIsThinking(false);

    const controller = new AbortController();
    abortRef.current = controller;

    let assistantText = '';
    let toolCalls = [];

    try {
      const token = api.getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const body = { message: text };
      if (conversationId) body.conversation_id = conversationId;

      const res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = null;
        let dataLines = [];
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
            dataLines = [];
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          } else if (line === '') {
            if (eventType && dataLines.length > 0) {
              processSSEEvent(eventType, dataLines.join('\n'));
            }
            eventType = null;
            dataLines = [];
          }
        }
      }

      if (buffer.trim()) {
        const remaining = buffer.split('\n');
        let eventType = null;
        let dataLines = [];
        for (const line of remaining) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
            dataLines = [];
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          } else if (line === '') {
            if (eventType && dataLines.length > 0) {
              processSSEEvent(eventType, dataLines.join('\n'));
            }
            eventType = null;
            dataLines = [];
          }
        }
        if (eventType && dataLines.length > 0) {
          processSSEEvent(eventType, dataLines.join('\n'));
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast(err.message, 'error');
      }
    }

    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: assistantText,
        toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
      },
    ]);
    setIsStreaming(false);
    setIsThinking(false);
    setCurrentAssistantMessage('');
    setCurrentToolCalls([]);
    abortRef.current = null;

    function processSSEEvent(type, rawData) {
      switch (type) {
        case 'conversation_id':
          setConversationId(rawData.trim());
          break;

        case 'thinking':
          setIsThinking(true);
          break;

        case 'text':
          setIsThinking(false);
          assistantText += rawData;
          setCurrentAssistantMessage(assistantText);
          break;

        case 'tool_call': {
          try {
            const parsed = JSON.parse(rawData);
            toolCalls = [...toolCalls, { tool: parsed.tool, input: parsed.input }];
            setCurrentToolCalls([...toolCalls]);
          } catch (e) {
            console.warn('Failed to parse tool_call', rawData);
          }
          break;
        }

        case 'tool_result': {
          try {
            const parsed = JSON.parse(rawData);
            const idx = toolCalls.findIndex(
              tc => tc.tool === parsed.tool && tc.result === undefined
            );
            if (idx !== -1) {
              toolCalls = [...toolCalls];
              toolCalls[idx] = { ...toolCalls[idx], result: parsed.result };
              setCurrentToolCalls([...toolCalls]);
            }
          } catch (e) {
            console.warn('Failed to parse tool_result', rawData);
          }
          break;
        }

        case 'done':
          break;

        default:
          break;
      }
    }
  }

  return html`
    <div class="chat-view">
      <${MessageList}
        messages=${messages}
        isStreaming=${isStreaming}
        isThinking=${isThinking}
        currentAssistantMessage=${currentAssistantMessage}
        currentToolCalls=${currentToolCalls}
      />
      <${InputBar} onSend=${handleSend} onStop=${() => abortRef.current?.abort()} disabled=${isStreaming} streaming=${isStreaming} />
    </div>
  `;
}

function MainView({ onLogout }) {
  const [tab, setTab] = useState('chat');
  const [theme, setTheme] = useState(getInitialTheme);

  // Chat state lives here so it survives tab switches
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('humanoms_theme', theme);
  }, [theme]);

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }

  function handleNewChat() {
    setMessages([]);
    setConversationId(null);
  }

  const themeIcon = theme === 'dark' ? ICONS.sun : ICONS.moon;

  return html`
    <div class="chat-layout">
      <div class="top-bar">
        <div class="top-bar-left">
          <div class="top-bar-title">HumanOMS</div>
          <div class="tab-bar">
            <button class="tab-btn ${tab === 'chat' ? 'active' : ''}" onClick=${() => setTab('chat')}>Chat</button>
            <button class="tab-btn ${tab === 'dashboard' ? 'active' : ''}" onClick=${() => setTab('dashboard')}>Dashboard</button>
          </div>
        </div>
        <div class="top-bar-actions">
          <button class="icon-btn" onClick=${toggleTheme} title="Toggle theme" dangerouslySetInnerHTML=${{ __html: themeIcon }} />
          ${tab === 'chat' && html`
            <button class="icon-btn" onClick=${handleNewChat} title="New chat" dangerouslySetInnerHTML=${{ __html: ICONS.plus }} />
          `}
          <button class="icon-btn" onClick=${onLogout} title="Logout" dangerouslySetInnerHTML=${{ __html: ICONS.logOut }} />
        </div>
      </div>
      <div style="display:${tab === 'chat' ? 'flex' : 'none'};flex:1;flex-direction:column;min-height:0">
        <${ChatView} messages=${messages} setMessages=${setMessages}
          conversationId=${conversationId} setConversationId=${setConversationId} />
      </div>
      <div style="display:${tab === 'dashboard' ? 'flex' : 'none'};flex:1;flex-direction:column;min-height:0">
        <${Dashboard} />
      </div>
      <${ToastContainer} />
    </div>
  `;
}

function App() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('humanoms_theme') || 'dark';
    document.documentElement.dataset.theme = saved;
  }, []);

  useEffect(() => {
    (async () => {
      if (api.getToken()) {
        try {
          await api.get('/api/v1/tasks');
          setAuthed(true);
        } catch (e) {
          api.setToken(null);
        }
      }
      setChecking(false);
    })();
  }, []);

  function handleLogout() {
    api.setToken(null);
    window.location.reload();
  }

  if (checking) {
    return html`<div class="loading">Loading...</div>`;
  }

  if (!authed) {
    return html`<${LoginGate} onLogin=${() => setAuthed(true)} />`;
  }

  return html`<${MainView} onLogout=${handleLogout} />`;
}

render(html`<${App} />`, document.getElementById('app'));

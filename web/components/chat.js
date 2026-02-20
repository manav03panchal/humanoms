import { html, useState, useEffect, useRef } from '/lib/preact.js';
import { renderCard } from '/components/cards.js';

const ICONS = {
  arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
};

/** Simple markdown to HTML converter */
function mdToHtml(text) {
  if (!text) return '';
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<div class="code-block">${langLabel}<button class="code-copy" onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent).then(()=>{this.textContent='copied';setTimeout(()=>this.textContent='copy',1500)})">copy</button><pre><code>${code.trim()}</code></pre></div>`;
  });

  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Tables
  s = s.replace(/((?:^\|.+\|\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return block;

    const isSep = /^\|[\s\-:]+\|/.test(rows[1]);
    const headerRow = rows[0];
    const dataRows = isSep ? rows.slice(2) : rows.slice(1);

    function parseCells(row) {
      return row.split('|').slice(1, -1).map(c => c.trim());
    }

    let table = '<table>';
    if (isSep) {
      const headers = parseCells(headerRow);
      table += '<thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
    } else {
      const cells = parseCells(headerRow);
      dataRows.unshift(headerRow);
      dataRows.shift();
      table += '<thead><tr>' + cells.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
    }

    if (dataRows.length > 0) {
      table += '<tbody>';
      for (const row of dataRows) {
        const cells = parseCells(row);
        table += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
      }
      table += '</tbody>';
    }
    table += '</table>';
    return table;
  });

  // Unordered lists
  s = s.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs
  s = s.replace(/^(?!<[hupolt])((?!<).+)$/gm, '<p>$1</p>');
  s = s.replace(/<p>\s*<\/p>/g, '');

  return s;
}

export function MessageList({ messages, isStreaming, isThinking, currentAssistantMessage, currentToolCalls }) {
  const listRef = useRef(null);
  const autoScrollRef = useRef(true);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }

  useEffect(() => {
    const el = listRef.current;
    if (el && autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, currentAssistantMessage, currentToolCalls]);

  const hasMessages = messages.length > 0 || isStreaming;

  return html`
    <div class="message-list" ref=${listRef} onScroll=${handleScroll}>
      ${!hasMessages && html`
        <div class="welcome-message">
          <div class="welcome-title">HumanOMS</div>
          <div class="welcome-text">
            Your personal task orchestration assistant. Ask me to manage tasks, create workflows, search your knowledge base, or check system status.
          </div>
        </div>
      `}
      ${messages.map((msg, i) =>
        msg.role === 'user'
          ? html`<${UserMessage} key=${i} content=${msg.content} />`
          : html`<${AssistantMessage} key=${i} content=${msg.content} toolCalls=${msg.toolCalls} />`
      )}
      ${isStreaming && html`
        <${AssistantMessage}
          content=${currentAssistantMessage}
          toolCalls=${currentToolCalls}
          streaming=${true}
        />
      `}
      ${isStreaming && isThinking && html`
        <div class="thinking-indicator">
          <span class="thinking-label">thinking</span>
          <div class="typing-dot" />
          <div class="typing-dot" />
          <div class="typing-dot" />
        </div>
      `}
      ${isStreaming && !isThinking && !currentAssistantMessage && currentToolCalls.length === 0 && html`
        <div class="typing-indicator">
          <div class="typing-dot" />
          <div class="typing-dot" />
          <div class="typing-dot" />
        </div>
      `}
    </div>
  `;
}

export function UserMessage({ content }) {
  return html`
    <div class="message message-user msg-enter">
      <div class="message-bubble">${content}</div>
    </div>
  `;
}

export function AssistantMessage({ content, toolCalls, streaming }) {
  const contentHtml = mdToHtml(content || '');

  return html`
    <div class="message message-assistant msg-enter">
      ${toolCalls && toolCalls.map((tc, i) => html`
        <${ToolCallBlock} key=${i} toolCall=${tc} />
      `)}
      ${contentHtml && html`
        <div class="message-content" dangerouslySetInnerHTML=${{ __html: contentHtml }} />
      `}
      ${streaming && !contentHtml && (!toolCalls || toolCalls.length === 0) && html`
        <div class="typing-indicator" style="padding: 2px 0;">
          <div class="typing-dot" />
          <div class="typing-dot" />
          <div class="typing-dot" />
        </div>
      `}
    </div>
  `;
}

export function ToolCallBlock({ toolCall }) {
  const [expanded, setExpanded] = useState(false);
  const { tool, input, result } = toolCall;
  const hasResult = result !== undefined && result !== null;

  const card = hasResult ? renderCard(tool, result) : null;

  return html`
    <div class="tool-call-block">
      <div class="tool-call-header" onClick=${() => setExpanded(!expanded)}>
        <span class="tool-call-chevron ${expanded ? 'open' : ''}" dangerouslySetInnerHTML=${{ __html: ICONS.chevronRight }} />
        <span class="tool-call-name">${tool}</span>
        <span class="tool-call-status ${hasResult ? 'done' : 'running'}">
          ${hasResult ? 'done' : 'running...'}
        </span>
      </div>
      ${expanded && html`
        <div class="tool-call-body">
          ${input && html`
            <div style="margin-bottom: 8px;">
              <div class="tool-call-label">Input</div>
              <pre>${JSON.stringify(input, null, 2)}</pre>
            </div>
          `}
          ${hasResult && html`
            <div>
              <div class="tool-call-label">Result</div>
              <pre>${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
            </div>
          `}
        </div>
      `}
    </div>
    ${hasResult && card}
  `;
}

export function InputBar({ onSend, onStop, disabled, streaming }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleInput(e) {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }

  return html`
    <div class="input-bar">
      <div class="input-bar-inner">
        <textarea
          ref=${textareaRef}
          value=${text}
          onInput=${handleInput}
          onKeyDown=${handleKeyDown}
          placeholder="Type a message..."
          rows="1"
          disabled=${disabled}
        />
        ${streaming ? html`
          <button
            class="send-btn stop-btn"
            onClick=${onStop}
            title="Stop"
            dangerouslySetInnerHTML=${{ __html: ICONS.stop }}
          />
        ` : html`
          <button
            class="send-btn"
            onClick=${submit}
            disabled=${disabled || !text.trim()}
            title="Send"
            dangerouslySetInnerHTML=${{ __html: ICONS.arrowUp }}
          />
        `}
      </div>
    </div>
  `;
}

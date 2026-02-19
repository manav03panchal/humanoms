import { html, useState, useEffect } from '/lib/preact.js';

let _setToasts = null;
let _idCounter = 0;

export function showToast(message, type = 'info') {
  if (!_setToasts) return;
  const id = ++_idCounter;
  _setToasts(prev => [...prev, { id, message, type }]);
  setTimeout(() => {
    _setToasts(prev => prev.filter(t => t.id !== id));
  }, 3000);
}

const COLORS = {
  info: 'var(--accent)',
  success: 'var(--success)',
  error: 'var(--error)',
  warning: 'var(--warning)',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  _setToasts = setToasts;

  return html`
    <div class="toast-container">
      ${toasts.map(t => html`
        <div class="toast" style="border-left: 3px solid ${COLORS[t.type] || COLORS.info}">
          ${t.message}
        </div>
      `)}
    </div>
  `;
}

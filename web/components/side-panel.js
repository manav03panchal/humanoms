import { html } from '/lib/preact.js';

export function SidePanel({ open, title, onClose, children }) {
  if (!open) return null;

  return html`
    <div class="panel-overlay" onClick=${onClose}>
      <div class="panel-body" onClick=${(e) => e.stopPropagation()}>
        <div class="panel-header">
          <span class="panel-title">${title}</span>
          <button class="panel-close" onClick=${onClose}>\u00D7</button>
        </div>
        <div class="panel-content">
          ${children}
        </div>
      </div>
    </div>
  `;
}

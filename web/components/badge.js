import { html } from '/lib/preact.js';

const STATUS_COLORS = {
  pending: '#eab308',
  in_progress: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  cancelled: '#6b7280',
  running: '#3b82f6',
  queued: '#a855f7',
  skipped: '#6b7280',
};

const PRIORITY_LABELS = ['none', 'low', 'medium', 'high', 'urgent'];
const PRIORITY_COLORS = ['#6b7280', '#22c55e', '#eab308', '#f97316', '#ef4444'];

export function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#6b7280';
  return html`<span class="badge" style="color:${color};border-color:${color}">${status}</span>`;
}

export function PriorityBadge({ priority }) {
  const p = Number(priority) || 0;
  const label = PRIORITY_LABELS[p] || 'none';
  const color = PRIORITY_COLORS[p] || '#6b7280';
  return html`<span class="badge" style="color:${color};border-color:${color}">${label}</span>`;
}

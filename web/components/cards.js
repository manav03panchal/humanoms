import { html } from '/lib/preact.js';

const STATUS_COLORS = {
  pending: 'var(--warning)',
  in_progress: 'var(--accent)',
  completed: 'var(--success)',
  failed: 'var(--error)',
  cancelled: 'var(--muted)',
  running: 'var(--accent)',
  queued: 'var(--muted)',
  skipped: 'var(--muted)',
};

const PRIORITY_LABELS = ['none', 'low', 'medium', 'high', 'urgent'];
const PRIORITY_COLORS = ['var(--muted)', 'var(--success)', 'var(--warning)', 'var(--accent)', 'var(--error)'];

function Badge({ label, color }) {
  return html`<span class="badge" style="color:${color};border-color:${color}">${label}</span>`;
}

export function TaskCard({ data }) {
  if (!data) return null;
  const color = STATUS_COLORS[data.status] || 'var(--muted)';
  const p = Number(data.priority) || 0;
  const priLabel = PRIORITY_LABELS[p] || 'none';
  const priColor = PRIORITY_COLORS[p] || 'var(--muted)';

  return html`
    <div class="rich-card">
      <div class="rich-card-header">
        <span>${data.title || 'Task'}</span>
        <${Badge} label=${data.status || 'unknown'} color=${color} />
      </div>
      <div class="rich-card-body">
        <div class="rich-card-row">
          <span class="rich-card-label">Priority</span>
          <${Badge} label=${priLabel} color=${priColor} />
        </div>
        ${data.due_date && html`
          <div class="rich-card-row">
            <span class="rich-card-label">Due</span>
            <span>${data.due_date}</span>
          </div>
        `}
        ${data.description && html`
          <div class="rich-card-row" style="flex-direction: column; gap: 2px;">
            <span class="rich-card-label">Description</span>
            <span>${data.description}</span>
          </div>
        `}
      </div>
    </div>
  `;
}

export function WorkflowCard({ data }) {
  if (!data) return null;
  const steps = data.steps || [];

  return html`
    <div class="rich-card">
      <div class="rich-card-header">
        <span>${data.name || 'Workflow'}</span>
        <span style="color: var(--muted); font-size: var(--text-xs);">${steps.length} steps</span>
      </div>
      <div class="rich-card-body">
        ${data.description && html`
          <div class="rich-card-row" style="margin-bottom: 4px;">
            <span>${data.description}</span>
          </div>
        `}
        ${steps.length > 0 && html`
          <div class="rich-card-steps">
            ${steps.map((step, i) => html`
              <div class="rich-card-step" key=${i}>${step.name || step}</div>
            `)}
          </div>
        `}
      </div>
    </div>
  `;
}

export function JobCard({ data }) {
  if (!data) return null;
  const color = STATUS_COLORS[data.status] || 'var(--muted)';
  const steps = data.steps || [];
  const completed = steps.filter(s => s.status === 'completed').length;

  return html`
    <div class="rich-card">
      <div class="rich-card-header">
        <span>Job${data.workflow_name ? ': ' + data.workflow_name : ''}</span>
        <${Badge} label=${data.status || 'unknown'} color=${color} />
      </div>
      <div class="rich-card-body">
        ${steps.length > 0 && html`
          <div class="rich-card-row">
            <span class="rich-card-label">Progress</span>
            <span>${completed} / ${steps.length} steps</span>
          </div>
        `}
        ${data.started_at && html`
          <div class="rich-card-row">
            <span class="rich-card-label">Started</span>
            <span>${data.started_at}</span>
          </div>
        `}
      </div>
    </div>
  `;
}

export function EntityCard({ data }) {
  if (!data) return null;
  const props = data.properties || data.metadata || {};
  const entries = Object.entries(props);

  return html`
    <div class="rich-card">
      <div class="rich-card-header">
        <span>${data.name || 'Entity'}</span>
        ${data.type && html`
          <span style="color: var(--muted); font-size: var(--text-xs);">${data.type}</span>
        `}
      </div>
      ${entries.length > 0 && html`
        <div class="rich-card-body">
          ${entries.slice(0, 8).map(([k, v]) => html`
            <div class="rich-card-row" key=${k}>
              <span class="rich-card-label">${k}</span>
              <span>${typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </div>
          `)}
          ${entries.length > 8 && html`
            <div style="color: var(--muted); font-size: var(--text-xs); margin-top: 4px;">
              +${entries.length - 8} more fields
            </div>
          `}
        </div>
      `}
    </div>
  `;
}

/** Extract items from tool result */
function extractItems(data, singular, plural) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data[plural] && Array.isArray(data[plural])) return data[plural];
  if (data[singular]) return [data[singular]];
  if (data.data && Array.isArray(data.data)) return data.data;
  if (data.data) return [data.data];
  if (data.id || data.title || data.name) return [data];
  return [];
}

/** Only render cards for read/list/create tools, not mutations */
const CARD_SKIP = /^(complete|update|delete)/;

/** Dispatcher: picks the right card based on tool name */
export function renderCard(toolName, data) {
  if (!data) return null;
  const name = (toolName || '').toLowerCase();
  if (CARD_SKIP.test(name)) return null;

  if (name.includes('task')) {
    const items = extractItems(data, 'task', 'tasks');
    if (items.length === 0) return null;
    return html`${items.map((d, i) => html`<${TaskCard} key=${i} data=${d} />`)}`;
  }

  if (name.includes('workflow') || name.includes('trigger')) {
    const items = extractItems(data, 'workflow', 'workflows');
    if (items.length === 0) return null;
    return html`${items.map((d, i) => html`<${WorkflowCard} key=${i} data=${d} />`)}`;
  }

  if (name.includes('job')) {
    const items = extractItems(data, 'job', 'jobs');
    if (items.length === 0) return null;
    return html`${items.map((d, i) => html`<${JobCard} key=${i} data=${d} />`)}`;
  }

  if (name.includes('entit')) {
    const items = extractItems(data, 'entity', 'entities');
    if (items.length === 0) return null;
    return html`${items.map((d, i) => html`<${EntityCard} key=${i} data=${d} />`)}`;
  }

  return null;
}

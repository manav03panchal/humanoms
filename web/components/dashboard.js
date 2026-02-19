import { html, useState, useEffect, useRef } from '/lib/preact.js';
import { api } from '/api.js';

const PRIORITY_LABELS = ['—', 'low', 'med', 'high', 'urgent'];
const STATUS_COLORS = {
  pending: 'var(--warning)',
  in_progress: 'var(--accent)',
  completed: 'var(--success)',
  failed: 'var(--error)',
  running: 'var(--accent)',
  queued: 'var(--muted)',
  cancelled: 'var(--muted)',
};

function ago(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatCard({ label, value, color }) {
  return html`
    <div class="dash-stat">
      <div class="dash-stat-value" style="color: ${color || 'var(--text)'}">${value}</div>
      <div class="dash-stat-label">${label}</div>
    </div>
  `;
}

function StatusDot({ status }) {
  const color = STATUS_COLORS[status] || 'var(--muted)';
  return html`<span class="dash-dot" style="background: ${color}" />`;
}

export function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  async function load() {
    try {
      const res = await api.get('/api/v1/dashboard/stats');
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 15000);
    return () => clearInterval(intervalRef.current);
  }, []);

  if (error) return html`<div class="dash-error">Failed to load: ${error}</div>`;
  if (!data) return html`<div class="dash-loading">Loading...</div>`;

  const { stats, recentJobs, recentTasks, automations } = data;

  return html`
    <div class="dash-container">
      <div class="dash-grid">
        <${StatCard} label="Pending Tasks" value=${stats.tasks_pending} color="var(--warning)" />
        <${StatCard} label="In Progress" value=${stats.tasks_in_progress} color="var(--accent)" />
        <${StatCard} label="Completed" value=${stats.tasks_completed} color="var(--success)" />
        <${StatCard} label="Overdue" value=${stats.tasks_overdue} color=${stats.tasks_overdue > 0 ? 'var(--error)' : 'var(--muted)'} />
        <${StatCard} label="Running Jobs" value=${stats.jobs_running} color="var(--accent)" />
        <${StatCard} label="Queued Jobs" value=${stats.jobs_queued} />
        <${StatCard} label="Automations" value=${stats.automations_enabled} />
        <${StatCard} label="Pending Approvals" value=${stats.approvals_pending} color=${stats.approvals_pending > 0 ? 'var(--warning)' : 'var(--muted)'} />
      </div>

      <div class="dash-panels">
        <div class="dash-panel">
          <div class="dash-panel-header">Recent Tasks</div>
          <div class="dash-panel-body">
            ${recentTasks.length === 0
              ? html`<div class="dash-empty">No tasks</div>`
              : recentTasks.map(t => html`
                <div class="dash-row" key=${t.id}>
                  <${StatusDot} status=${t.status} />
                  <span class="dash-row-title">${t.title}</span>
                  <span class="dash-row-meta">${PRIORITY_LABELS[t.priority] || '—'}</span>
                  <span class="dash-row-meta">${ago(t.updated_at)}</span>
                </div>
              `)
            }
          </div>
        </div>

        <div class="dash-panel">
          <div class="dash-panel-header">Recent Jobs</div>
          <div class="dash-panel-body">
            ${recentJobs.length === 0
              ? html`<div class="dash-empty">No jobs</div>`
              : recentJobs.map(j => html`
                <div class="dash-row" key=${j.id}>
                  <${StatusDot} status=${j.status} />
                  <span class="dash-row-title">${j.workflow_name || j.id.slice(0, 8)}</span>
                  <span class="dash-row-meta">${j.status}</span>
                  <span class="dash-row-meta">${ago(j.created_at)}</span>
                </div>
              `)
            }
          </div>
        </div>

        <div class="dash-panel dash-panel-full">
          <div class="dash-panel-header">Automations</div>
          <div class="dash-panel-body">
            ${automations.length === 0
              ? html`<div class="dash-empty">No automations</div>`
              : automations.map(a => html`
                <div class="dash-row" key=${a.id}>
                  <span class="dash-dot" style="background: ${a.enabled ? 'var(--success)' : 'var(--muted)'}" />
                  <span class="dash-row-title">${a.name}</span>
                  <span class="dash-row-meta">${a.workflow_name || '—'}</span>
                  <span class="dash-row-meta mono">${a.cron_expression}</span>
                </div>
              `)
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

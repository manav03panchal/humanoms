import { html, useState, useEffect, useCallback } from '/lib/preact.js';
import { api } from '/api.js';
import { DataTable } from '/components/table.js';
import { SidePanel } from '/components/side-panel.js';
import { showToast } from '/components/toast.js';

function AutomationsView({ onRefreshCounts }) {
  const [automations, setAutomations] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState(null); // 'create' | 'edit'
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({
    name: '', description: '', cron_expression: '', workflow_id: '', input: '{}', enabled: true,
  });

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await api.get('/api/v1/automations');
      setAutomations(res.data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await api.get('/api/v1/workflows');
      setWorkflows(res.data || []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
    fetchWorkflows();
  }, []);

  function openCreate() {
    setForm({ name: '', description: '', cron_expression: '', workflow_id: '', input: '{}', enabled: true });
    setSelected(null);
    setPanel('create');
    fetchWorkflows();
  }

  function openEdit(a) {
    setForm({
      name: a.name || '',
      description: a.description || '',
      cron_expression: a.cron_expression || '',
      workflow_id: a.workflow_id || '',
      input: JSON.stringify(a.input || {}, null, 2),
      enabled: a.enabled !== false,
    });
    setSelected(a);
    setPanel('edit');
    fetchWorkflows();
  }

  function closePanel() {
    setPanel(null);
    setSelected(null);
  }

  async function handleSave() {
    let input;
    try {
      input = JSON.parse(form.input);
    } catch {
      showToast('Invalid JSON in input', 'error');
      return;
    }
    const body = {
      name: form.name,
      description: form.description || undefined,
      cron_expression: form.cron_expression,
      workflow_id: form.workflow_id,
      input,
      enabled: form.enabled,
    };
    try {
      if (panel === 'edit' && selected) {
        await api.patch(`/api/v1/automations/${selected.id}`, body);
        showToast('Automation updated', 'success');
      } else {
        await api.post('/api/v1/automations', body);
        showToast('Automation created', 'success');
      }
      closePanel();
      fetchAutomations();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete(a) {
    if (!confirm(`Delete automation "${a.name}"?`)) return;
    try {
      await api.del(`/api/v1/automations/${a.id}`);
      showToast('Automation deleted', 'success');
      fetchAutomations();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function toggleEnabled(a) {
    try {
      await api.patch(`/api/v1/automations/${a.id}`, { enabled: !a.enabled });
      fetchAutomations();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'cron_expression', label: 'Cron' },
    { key: 'workflow_id', label: 'Workflow', render: (v) => v && v.length > 12 ? v.slice(0, 12) + '...' : v || '' },
    { key: 'enabled', label: 'Enabled', render: (v, row) => html`
      <button class="toggle-switch ${v !== false ? 'toggle-on' : 'toggle-off'}" onClick=${() => toggleEnabled(row)}>
        <span class="toggle-knob" />
      </button>
    ` },
    { key: 'last_run_at', label: 'Last Run', render: (v) => v ? new Date(v).toLocaleString() : '-' },
    { key: 'next_run_at', label: 'Next Run', render: (v) => v ? new Date(v).toLocaleString() : '-' },
  ];

  const actions = [
    { label: 'Edit', onClick: openEdit },
    { label: 'Delete', color: '#ef4444', onClick: handleDelete },
  ];

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div class="view-container">
      <div class="view-header">
        <h2>Automations</h2>
        <button class="btn-primary" onClick=${openCreate}>+ New Automation</button>
      </div>
      <${DataTable} columns=${columns} data=${automations} actions=${actions} />

      <${SidePanel} open=${panel === 'create' || panel === 'edit'} title=${panel === 'edit' ? 'Edit Automation' : 'New Automation'} onClose=${closePanel}>
        <div class="form-group">
          <label>Name</label>
          <input class="form-input" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} placeholder="Automation name" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea class="form-input" rows="2" value=${form.description} onInput=${(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
        </div>
        <div class="form-group">
          <label>Cron Expression</label>
          <input class="form-input" style="font-family:monospace" value=${form.cron_expression} onInput=${(e) => setForm({ ...form, cron_expression: e.target.value })} placeholder="0 8 * * *" />
        </div>
        <div class="form-group">
          <label>Workflow</label>
          <select class="form-input" value=${form.workflow_id} onChange=${(e) => setForm({ ...form, workflow_id: e.target.value })}>
            <option value="">-- Select workflow --</option>
            ${workflows.map(w => html`<option value=${w.id}>${w.name || w.id}</option>`)}
          </select>
        </div>
        <div class="form-group">
          <label>Input (JSON)</label>
          <textarea class="form-input form-json" value=${form.input} onInput=${(e) => setForm({ ...form, input: e.target.value })} placeholder='{}' />
        </div>
        <div class="form-group">
          <label class="form-checkbox-label">
            <input type="checkbox" checked=${form.enabled} onChange=${(e) => setForm({ ...form, enabled: e.target.checked })} />
            Enabled
          </label>
        </div>
        <button class="btn-primary" onClick=${handleSave}>${panel === 'edit' ? 'Update' : 'Create'}</button>
      <//>
    </div>
  `;
}

export default AutomationsView;

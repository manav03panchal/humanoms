import { html, useState, useEffect, useCallback } from '/lib/preact.js';
import { api } from '/api.js';
import { DataTable } from '/components/table.js';
import { SidePanel } from '/components/side-panel.js';
import { showToast } from '/components/toast.js';

function WorkflowsView({ onRefreshCounts }) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState(null); // 'create' | 'edit' | 'trigger'
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', steps: '[]' });
  const [triggerInput, setTriggerInput] = useState('{}');

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await api.get('/api/v1/workflows');
      setWorkflows(res.data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWorkflows(); }, []);

  function openCreate() {
    setForm({ name: '', description: '', steps: '[]' });
    setSelected(null);
    setPanel('create');
  }

  function openEdit(wf) {
    setForm({
      name: wf.name || '',
      description: wf.description || '',
      steps: JSON.stringify(wf.steps || [], null, 2),
    });
    setSelected(wf);
    setPanel('edit');
  }

  function openTrigger(wf) {
    setSelected(wf);
    setTriggerInput('{}');
    setPanel('trigger');
  }

  function closePanel() {
    setPanel(null);
    setSelected(null);
  }

  async function handleSave() {
    let steps;
    try {
      steps = JSON.parse(form.steps);
    } catch {
      showToast('Invalid JSON in steps', 'error');
      return;
    }
    const body = { name: form.name, description: form.description || undefined, steps };
    try {
      if (panel === 'edit' && selected) {
        await api.patch(`/api/v1/workflows/${selected.id}`, body);
        showToast('Workflow updated', 'success');
      } else {
        await api.post('/api/v1/workflows', body);
        showToast('Workflow created', 'success');
      }
      closePanel();
      fetchWorkflows();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete(wf) {
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    try {
      await api.del(`/api/v1/workflows/${wf.id}`);
      showToast('Workflow deleted', 'success');
      fetchWorkflows();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleTrigger() {
    let input;
    try {
      input = JSON.parse(triggerInput);
    } catch {
      showToast('Invalid JSON input', 'error');
      return;
    }
    try {
      await api.post(`/api/v1/workflows/${selected.id}/trigger`, { input });
      showToast('Workflow triggered', 'success');
      closePanel();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description', render: (v) => {
      const s = v || '';
      return s.length > 60 ? s.slice(0, 60) + '...' : s;
    }},
    { key: 'steps', label: 'Steps', render: (v) => (v || []).length },
    { key: 'enabled', label: 'Enabled', render: (v) => v === false ? 'No' : 'Yes' },
    { key: 'created_at', label: 'Created', render: (v) => v ? new Date(v).toLocaleString() : '' },
  ];

  const actions = [
    { label: 'Trigger', color: '#3b82f6', onClick: openTrigger },
    { label: 'Edit', onClick: openEdit },
    { label: 'Delete', color: '#ef4444', onClick: handleDelete },
  ];

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div class="view-container">
      <div class="view-header">
        <h2>Workflows</h2>
        <button class="btn-primary" onClick=${openCreate}>+ New Workflow</button>
      </div>
      <${DataTable} columns=${columns} data=${workflows} actions=${actions} />

      <${SidePanel} open=${panel === 'create' || panel === 'edit'} title=${panel === 'edit' ? 'Edit Workflow' : 'New Workflow'} onClose=${closePanel}>
        <div class="form-group">
          <label>Name</label>
          <input class="form-input" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} placeholder="Workflow name" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea class="form-input" rows="3" value=${form.description} onInput=${(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
        </div>
        <div class="form-group">
          <label>Steps (JSON array)</label>
          <textarea class="form-input form-json" value=${form.steps} onInput=${(e) => setForm({ ...form, steps: e.target.value })} placeholder='[{"type": "..."}]' />
        </div>
        <button class="btn-primary" onClick=${handleSave}>${panel === 'edit' ? 'Update' : 'Create'}</button>
      <//>

      <${SidePanel} open=${panel === 'trigger'} title=${`Trigger: ${selected?.name || ''}`} onClose=${closePanel}>
        <div class="form-group">
          <label>Input (JSON)</label>
          <textarea class="form-input form-json" value=${triggerInput} onInput=${(e) => setTriggerInput(e.target.value)} placeholder='{}' />
        </div>
        <button class="btn-primary" onClick=${handleTrigger}>Run</button>
      <//>
    </div>
  `;
}

export default WorkflowsView;

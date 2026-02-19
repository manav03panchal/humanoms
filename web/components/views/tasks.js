import { html, useState, useEffect, useCallback } from '/lib/preact.js';
import { api } from '/api.js';
import { DataTable } from '/components/table.js';
import { SidePanel } from '/components/side-panel.js';
import { showToast } from '/components/toast.js';
import { StatusBadge, PriorityBadge } from '/components/badge.js';

const STATUS_OPTIONS = ['pending', 'in_progress', 'completed', 'cancelled'];
const FILTER_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

const EMPTY_FORM = {
  title: '',
  description: '',
  status: 'pending',
  priority: 0,
  due_date: '',
  recurrence: '',
  tags: '',
};

function TasksView({ onRefreshCounts }) {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      const path = filter ? `/api/v1/tasks?status=${filter}` : '/api/v1/tasks';
      const res = await api.get(path);
      setTasks(res.data || []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPanelOpen(true);
  }

  function openEdit(task) {
    setEditing(task);
    setForm({
      title: task.title || '',
      description: task.description || '',
      status: task.status || 'pending',
      priority: task.priority ?? 0,
      due_date: task.due_date ? task.due_date.slice(0, 10) : '',
      recurrence: task.recurrence || '',
      tags: (task.tags || []).join(', '),
    });
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setEditing(null);
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      title: form.title,
      description: form.description || undefined,
      status: form.status,
      priority: Number(form.priority),
      due_date: form.due_date || undefined,
      recurrence: form.recurrence || undefined,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      metadata: {},
    };
    try {
      if (editing) {
        await api.patch(`/api/v1/tasks/${editing.id}`, payload);
        showToast('Updated!', 'success');
      } else {
        await api.post('/api/v1/tasks', payload);
        showToast('Created!', 'success');
      }
      closePanel();
      load();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete(task) {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    try {
      await api.del(`/api/v1/tasks/${task.id}`);
      showToast('Deleted!', 'success');
      load();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const columns = [
    { key: 'status', label: 'Status', render: (v) => html`<${StatusBadge} status=${v} />` },
    { key: 'title', label: 'Title' },
    { key: 'priority', label: 'Priority', render: (v) => html`<${PriorityBadge} priority=${v} />` },
    { key: 'due_date', label: 'Due Date', render: (v) => v ? v.slice(0, 10) : '\u2014' },
    { key: 'tags', label: 'Tags', render: (v) => (v || []).join(', ') || '\u2014' },
  ];

  const actions = [
    { label: 'Edit', onClick: openEdit },
    { label: 'Delete', color: '#ef4444', onClick: handleDelete },
  ];

  return html`
    <div class="view">
      <div class="view-header">
        <h2 class="view-title">Tasks</h2>
        <div class="view-controls">
          <select class="input-field" value=${filter} onChange=${(e) => setFilter(e.target.value)}>
            ${FILTER_OPTIONS.map(o => html`<option value=${o.value}>${o.label}</option>`)}
          </select>
          <button class="btn-primary" onClick=${openCreate}>+ New Task</button>
        </div>
      </div>
      <${DataTable} columns=${columns} data=${tasks} actions=${actions} />
      <${SidePanel} open=${panelOpen} title=${editing ? 'Edit Task' : 'New Task'} onClose=${closePanel}>
        <form class="panel-form" onSubmit=${handleSubmit}>
          <label>Title</label>
          <input class="input-field" value=${form.title} onInput=${(e) => setField('title', e.target.value)} required />
          <label>Description</label>
          <textarea class="input-field" rows="3" value=${form.description} onInput=${(e) => setField('description', e.target.value)} />
          <label>Status</label>
          <select class="input-field" value=${form.status} onChange=${(e) => setField('status', e.target.value)}>
            ${STATUS_OPTIONS.map(s => html`<option value=${s}>${s}</option>`)}
          </select>
          <label>Priority (0-4)</label>
          <input class="input-field" type="number" min="0" max="4" value=${form.priority} onInput=${(e) => setField('priority', e.target.value)} />
          <label>Due Date</label>
          <input class="input-field" type="date" value=${form.due_date} onInput=${(e) => setField('due_date', e.target.value)} />
          <label>Recurrence</label>
          <input class="input-field" value=${form.recurrence} onInput=${(e) => setField('recurrence', e.target.value)} placeholder="e.g. daily, weekly" />
          <label>Tags (comma-separated)</label>
          <input class="input-field" value=${form.tags} onInput=${(e) => setField('tags', e.target.value)} />
          <button type="submit" class="btn-primary" style="margin-top:12px">${editing ? 'Update' : 'Create'}</button>
        </form>
      <//>
    </div>
  `;
}

export default TasksView;

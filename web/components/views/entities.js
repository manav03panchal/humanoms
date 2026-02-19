import { html, useState, useEffect, useCallback } from '/lib/preact.js';
import { api } from '/api.js';
import { DataTable } from '/components/table.js';
import { SidePanel } from '/components/side-panel.js';
import { showToast } from '/components/toast.js';
import { StatusBadge } from '/components/badge.js';

const EMPTY_FORM = {
  type: '',
  name: '',
  properties: '{}',
  tags: '',
  parent_id: '',
  source_id: '',
};

function EntitiesView({ onRefreshCounts }) {
  const [entities, setEntities] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [types, setTypes] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      let path = '/api/v1/entities';
      const params = [];
      if (typeFilter) params.push(`type=${encodeURIComponent(typeFilter)}`);
      if (search) params.push(`q=${encodeURIComponent(search)}`);
      if (params.length) path += '?' + params.join('&');
      const res = await api.get(path);
      const data = res.data || [];
      setEntities(data);
      const seen = new Set(data.map(e => e.type).filter(Boolean));
      setTypes(prev => {
        const merged = new Set([...prev, ...seen]);
        return [...merged].sort();
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [typeFilter, search]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPanelOpen(true);
  }

  function openEdit(entity) {
    setEditing(entity);
    setForm({
      type: entity.type || '',
      name: entity.name || '',
      properties: JSON.stringify(entity.properties || {}, null, 2),
      tags: (entity.tags || []).join(', '),
      parent_id: entity.parent_id || '',
      source_id: entity.source_id || '',
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

  function handleSearchKey(e) {
    if (e.key === 'Enter') {
      setSearch(e.target.value);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    let properties;
    try {
      properties = JSON.parse(form.properties);
    } catch {
      showToast('Invalid JSON in properties', 'error');
      return;
    }
    const payload = {
      type: form.type,
      name: form.name,
      properties,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      parent_id: form.parent_id || undefined,
      source_id: form.source_id || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/api/v1/entities/${editing.id}`, payload);
        showToast('Updated!', 'success');
      } else {
        await api.post('/api/v1/entities', payload);
        showToast('Created!', 'success');
      }
      closePanel();
      load();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete(entity) {
    if (!confirm(`Delete entity "${entity.name}"?`)) return;
    try {
      await api.del(`/api/v1/entities/${entity.id}`);
      showToast('Deleted!', 'success');
      load();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const columns = [
    { key: 'type', label: 'Type', render: (v) => html`<${StatusBadge} status=${v} />` },
    { key: 'name', label: 'Name' },
    { key: 'tags', label: 'Tags', render: (v) => (v || []).join(', ') || '\u2014' },
    { key: 'created_at', label: 'Created', render: (v) => v ? v.slice(0, 10) : '\u2014' },
  ];

  const actions = [
    { label: 'Edit', onClick: openEdit },
    { label: 'Delete', color: '#ef4444', onClick: handleDelete },
  ];

  return html`
    <div class="view">
      <div class="view-header">
        <h2 class="view-title">Entities</h2>
        <div class="view-controls">
          <input
            class="input-field"
            placeholder="Search... (Enter)"
            onKeyDown=${handleSearchKey}
          />
          <select class="input-field" value=${typeFilter} onChange=${(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            ${types.map(t => html`<option value=${t}>${t}</option>`)}
          </select>
          <button class="btn-primary" onClick=${openCreate}>+ New Entity</button>
        </div>
      </div>
      <${DataTable} columns=${columns} data=${entities} actions=${actions} />
      <${SidePanel} open=${panelOpen} title=${editing ? 'Edit Entity' : 'New Entity'} onClose=${closePanel}>
        <form class="panel-form" onSubmit=${handleSubmit}>
          <label>Type</label>
          <input class="input-field" value=${form.type} onInput=${(e) => setField('type', e.target.value)} required />
          <label>Name</label>
          <input class="input-field" value=${form.name} onInput=${(e) => setField('name', e.target.value)} required />
          <label>Properties (JSON)</label>
          <textarea class="input-field mono" rows="5" value=${form.properties} onInput=${(e) => setField('properties', e.target.value)} />
          <label>Tags (comma-separated)</label>
          <input class="input-field" value=${form.tags} onInput=${(e) => setField('tags', e.target.value)} />
          <label>Parent ID (optional)</label>
          <input class="input-field" value=${form.parent_id} onInput=${(e) => setField('parent_id', e.target.value)} />
          <label>Source ID (optional)</label>
          <input class="input-field" value=${form.source_id} onInput=${(e) => setField('source_id', e.target.value)} />
          <button type="submit" class="btn-primary" style="margin-top:12px">${editing ? 'Update' : 'Create'}</button>
        </form>
      <//>
    </div>
  `;
}

export default EntitiesView;

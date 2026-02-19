import { html, useState, useEffect, useCallback } from '/lib/preact.js';
import { api } from '/api.js';
import { DataTable } from '/components/table.js';
import { SidePanel } from '/components/side-panel.js';
import { showToast } from '/components/toast.js';

const EMPTY_FORM = {
  name: '',
  path: '',
  mime_type: '',
  metadata: '{}',
};

function formatSize(bytes) {
  if (bytes == null) return '\u2014';
  const n = Number(bytes);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function truncateHash(hash) {
  if (!hash) return '\u2014';
  if (hash.length <= 16) return hash;
  return hash.slice(0, 8) + '\u2026' + hash.slice(-8);
}

function FilesView({ onRefreshCounts }) {
  const [files, setFiles] = useState([]);
  const [mimeFilter, setMimeFilter] = useState('');
  const [mimeTypes, setMimeTypes] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      let path = '/api/v1/files';
      if (mimeFilter) path += `?mime_type=${encodeURIComponent(mimeFilter)}`;
      const res = await api.get(path);
      const data = res.data || [];
      setFiles(data);
      const seen = new Set(data.map(f => f.mime_type).filter(Boolean));
      setMimeTypes(prev => {
        const merged = new Set([...prev, ...seen]);
        return [...merged].sort();
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [mimeFilter]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    let metadata;
    try {
      metadata = JSON.parse(form.metadata);
    } catch {
      showToast('Invalid JSON in metadata', 'error');
      return;
    }
    const payload = {
      name: form.name,
      path: form.path,
      mime_type: form.mime_type || undefined,
      metadata,
    };
    try {
      await api.post('/api/v1/files', payload);
      showToast('Created!', 'success');
      closePanel();
      load();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete(file) {
    if (!confirm(`Delete file "${file.name}"?`)) return;
    try {
      await api.del(`/api/v1/files/${file.id}`);
      showToast('Deleted!', 'success');
      load();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'path', label: 'Path' },
    { key: 'mime_type', label: 'MIME Type', render: (v) => v || '\u2014' },
    { key: 'size', label: 'Size', render: (v) => formatSize(v) },
    { key: 'hash', label: 'Hash', render: (v) => truncateHash(v) },
    { key: 'created_at', label: 'Created', render: (v) => v ? v.slice(0, 10) : '\u2014' },
  ];

  const actions = [
    { label: 'Delete', color: '#ef4444', onClick: handleDelete },
  ];

  return html`
    <div class="view">
      <div class="view-header">
        <h2 class="view-title">Files</h2>
        <div class="view-controls">
          <select class="input-field" value=${mimeFilter} onChange=${(e) => setMimeFilter(e.target.value)}>
            <option value="">All Types</option>
            ${mimeTypes.map(m => html`<option value=${m}>${m}</option>`)}
          </select>
          <button class="btn-primary" onClick=${openCreate}>+ Register File</button>
        </div>
      </div>
      <${DataTable} columns=${columns} data=${files} actions=${actions} />
      <${SidePanel} open=${panelOpen} title="Register File" onClose=${closePanel}>
        <form class="panel-form" onSubmit=${handleSubmit}>
          <label>Name</label>
          <input class="input-field" value=${form.name} onInput=${(e) => setField('name', e.target.value)} required />
          <label>Path</label>
          <input class="input-field" value=${form.path} onInput=${(e) => setField('path', e.target.value)} required />
          <label>MIME Type (optional)</label>
          <input class="input-field" value=${form.mime_type} onInput=${(e) => setField('mime_type', e.target.value)} />
          <label>Metadata (JSON)</label>
          <textarea class="input-field mono" rows="4" value=${form.metadata} onInput=${(e) => setField('metadata', e.target.value)} />
          <button type="submit" class="btn-primary" style="margin-top:12px">Register</button>
        </form>
      <//>
    </div>
  `;
}

export default FilesView;

import { html, useState, useEffect, useRef } from '/lib/preact.js';
import { api } from '/api.js';
import { showToast } from '/components/toast.js';

function formatUptime(seconds) {
  if (seconds == null) return '-';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

function SettingsView() {
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState(api.getToken() || '');
  const [editingKey, setEditingKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const timerRef = useRef(null);

  async function fetchStatus() {
    try {
      const res = await api.get('/api/v1/system/status');
      setStatus(res.data || res);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  useEffect(() => {
    fetchStatus();
    timerRef.current = setInterval(fetchStatus, 5000);
    return () => clearInterval(timerRef.current);
  }, []);

  function maskKey(key) {
    if (!key) return '(not set)';
    if (key.length <= 8) return '*'.repeat(key.length);
    return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
  }

  function handleChangeKey() {
    if (editingKey) {
      if (newKey.trim()) {
        api.setToken(newKey.trim());
        setApiKey(newKey.trim());
        showToast('API key updated', 'success');
      }
      setEditingKey(false);
      setNewKey('');
    } else {
      setNewKey('');
      setEditingKey(true);
    }
  }

  function handleClearKey() {
    api.setToken(null);
    setApiKey('');
    showToast('API key cleared', 'info');
    window.location.reload();
  }

  return html`
    <div class="view-container">
      <div class="view-header">
        <h2>Settings</h2>
      </div>

      <div class="settings-card">
        <h3>System Status</h3>
        ${status ? html`
          <div class="settings-row">
            <span class="settings-label">Status</span>
            <span class="settings-value">${status.status || 'ok'}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">Uptime</span>
            <span class="settings-value">${formatUptime(status.uptime_seconds)}</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">Version</span>
            <span class="settings-value">${status.version || '-'}</span>
          </div>
        ` : html`<div class="loading">Loading...</div>`}
      </div>

      <div class="settings-card">
        <h3>API Key</h3>
        <div class="settings-row">
          <span class="settings-label">Current Key</span>
          <span class="settings-value" style="font-family:monospace">${maskKey(apiKey)}</span>
        </div>
        ${editingKey && html`
          <div class="settings-row">
            <input class="form-input" type="password" value=${newKey} onInput=${(e) => setNewKey(e.target.value)} placeholder="Enter new API key" style="flex:1" />
          </div>
        `}
        <div class="settings-actions">
          <button class="btn-primary" onClick=${handleChangeKey}>${editingKey ? 'Save' : 'Change'}</button>
          ${editingKey && html`<button class="btn-secondary" onClick=${() => setEditingKey(false)}>Cancel</button>`}
          ${!editingKey && apiKey && html`<button class="btn-danger" onClick=${handleClearKey}>Clear</button>`}
        </div>
      </div>

      <div class="settings-card">
        <h3>Connection</h3>
        <div class="settings-row">
          <span class="settings-label">Base URL</span>
          <span class="settings-value" style="font-family:monospace">${window.location.origin}</span>
        </div>
      </div>
    </div>
  `;
}

export default SettingsView;

import { html, useState, useEffect, useCallback, useRef } from '/lib/preact.js';
import { api } from '/api.js';
import { DataTable } from '/components/table.js';
import { SidePanel } from '/components/side-panel.js';
import { showToast } from '/components/toast.js';
import { StatusBadge } from '/components/badge.js';

const STATUS_OPTIONS = ['All', 'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'rejected'];

function JobsView() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const timerRef = useRef(null);

  const fetchJobs = useCallback(async () => {
    try {
      const query = statusFilter !== 'All' ? `?status=${statusFilter}` : '';
      const res = await api.get(`/api/v1/jobs${query}`);
      setJobs(res.data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchJobs();
    timerRef.current = setInterval(fetchJobs, 3000);
    return () => clearInterval(timerRef.current);
  }, [fetchJobs]);

  async function openDetail(job) {
    setSelected(job);
    try {
      const res = await api.get(`/api/v1/jobs/${job.id}`);
      setDetail(res.data || res);
    } catch (err) {
      showToast(err.message, 'error');
      setDetail(job);
    }
  }

  function closePanel() {
    setSelected(null);
    setDetail(null);
  }

  function truncId(id) {
    if (!id) return '';
    return id.length > 12 ? id.slice(0, 12) + '...' : id;
  }

  function fmtJson(val) {
    if (val == null) return 'null';
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }

  const columns = [
    { key: 'id', label: 'ID', render: (v) => truncId(v) },
    { key: 'workflow_id', label: 'Workflow', render: (v) => truncId(v) },
    { key: 'status', label: 'Status', render: (v) => html`<${StatusBadge} status=${v} />` },
    { key: 'current_step', label: 'Step', render: (v) => v != null ? v : '-' },
    { key: 'created_at', label: 'Created', render: (v) => v ? new Date(v).toLocaleString() : '' },
    { key: 'started_at', label: 'Started', render: (v) => v ? new Date(v).toLocaleString() : '-' },
    { key: 'completed_at', label: 'Completed', render: (v) => v ? new Date(v).toLocaleString() : '-' },
  ];

  const actions = [
    { label: 'View', onClick: openDetail },
  ];

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div class="view-container">
      <div class="view-header">
        <h2>Jobs</h2>
        <select class="form-input" style="width:auto" value=${statusFilter} onChange=${(e) => setStatusFilter(e.target.value)}>
          ${STATUS_OPTIONS.map(s => html`<option value=${s}>${s === 'All' ? 'All Statuses' : s.replace(/_/g, ' ')}</option>`)}
        </select>
      </div>
      <${DataTable} columns=${columns} data=${jobs} actions=${actions} />

      <${SidePanel} open=${!!selected} title=${`Job ${truncId(selected?.id)}`} onClose=${closePanel}>
        ${detail && html`
          <div class="detail-section">
            <h4>Status</h4>
            <${StatusBadge} status=${detail.status} />
          </div>
          <div class="detail-section">
            <h4>Input</h4>
            <pre class="detail-json">${fmtJson(detail.input)}</pre>
          </div>
          <div class="detail-section">
            <h4>Context</h4>
            <pre class="detail-json">${fmtJson(detail.context)}</pre>
          </div>
          <div class="detail-section">
            <h4>Output</h4>
            <pre class="detail-json">${fmtJson(detail.output)}</pre>
          </div>
          ${detail.error && html`
            <div class="detail-section">
              <h4>Error</h4>
              <pre class="detail-json" style="color:#ef4444">${fmtJson(detail.error)}</pre>
            </div>
          `}
        `}
      <//>
    </div>
  `;
}

export default JobsView;

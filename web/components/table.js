import { html, useState } from '/lib/preact.js';

export function DataTable({ columns, data, actions }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);

  function handleSort(key) {
    if (sortKey === key) setSortDir(-sortDir);
    else { setSortKey(key); setSortDir(1); }
  }

  let rows = data || [];
  if (sortKey) {
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    });
  }

  return html`
    <table class="data-table">
      <thead>
        <tr>
          ${columns.map(col => html`
            <th onClick=${() => handleSort(col.key)} class="sortable">
              ${col.label}
              ${sortKey === col.key ? (sortDir === 1 ? ' \u25B2' : ' \u25BC') : ''}
            </th>
          `)}
          ${actions && actions.length > 0 && html`<th>Actions</th>`}
        </tr>
      </thead>
      <tbody>
        ${rows.length === 0 && html`
          <tr><td colspan=${columns.length + (actions ? 1 : 0)} class="empty-row">No data</td></tr>
        `}
        ${rows.map((row, i) => html`
          <tr class=${i % 2 === 0 ? 'row-even' : 'row-odd'}>
            ${columns.map(col => html`
              <td>${col.render ? col.render(row[col.key], row) : row[col.key]}</td>
            `)}
            ${actions && actions.length > 0 && html`
              <td class="actions-cell">
                ${actions.map(act => html`
                  <button
                    class="btn-action"
                    style=${act.color ? `color:${act.color}` : ''}
                    onClick=${() => act.onClick(row)}
                  >${act.label}</button>
                `)}
              </td>
            `}
          </tr>
        `)}
      </tbody>
    </table>
  `;
}

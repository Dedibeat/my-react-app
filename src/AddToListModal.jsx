import { useState } from 'react';
import './AddToListModal.css';
import { api } from './api.js';

// Adds a set of problems to an existing list or a freshly named one.
// Dedup is server-side; the toast reports {added, existing}.
export default function AddToListModal({ problems, lists, onClose, onSaved, onError }) {
  const [mode, setMode] = useState(lists.length > 0 ? 'existing' : 'new');
  const [listId, setListId] = useState(lists.length > 0 ? String(lists[0].id) : '');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);

  const canSave = mode === 'existing' ? listId !== '' : name.trim().length > 0;

  async function save() {
    setSending(true);
    try {
      let targetId = Number(listId);
      if (mode === 'new') {
        targetId = (await api.createList(name.trim())).id;
      }
      const res = await api.addToList(targetId, problems.map((p) => Number(p.id)));
      onSaved(res.added, res.existing);
      onClose();
    } catch (err) {
      setSending(false);
      onError(err);
    }
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="alt-title">
        <div>
          <h2 className="modal-title" id="alt-title">
            Add {problems.length} {problems.length === 1 ? 'problem' : 'problems'} to a list
          </h2>
          <p className="modal-subtitle">Problems already in the list are skipped.</p>
        </div>

        {lists.length > 0 && (
          <div className="mode-toggle" role="group" aria-label="Target list">
            <button
              type="button"
              className={mode === 'existing' ? 'on' : ''}
              onClick={() => setMode('existing')}
            >
              Existing list
            </button>
            <button
              type="button"
              className={mode === 'new' ? 'on' : ''}
              onClick={() => setMode('new')}
            >
              New list
            </button>
          </div>
        )}

        {mode === 'existing' && lists.length > 0 ? (
          <label className="field">
            <span>List</span>
            <select value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.problem_count})</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>List name</span>
            <input
              autoFocus
              type="text"
              maxLength={100}
              placeholder="e.g. DP practice"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSave) save(); }}
            />
          </label>
        )}

        <div className="modal-actions">
          <span className="modal-spacer" />
          <button type="button" className="btn" disabled={sending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave || sending}
            onClick={save}
          >
            {sending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

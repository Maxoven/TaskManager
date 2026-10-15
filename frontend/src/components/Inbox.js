import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { useInbox } from '../context/InboxContext';
import { getInbox, updateInboxItem, deleteInboxItem } from '../services/api';
import { formatDate, daysUntil } from '../utils/date';
import apiError from '../utils/apiError';
import AppHeader from './AppHeader';
import { QuickAddForm } from './QuickAdd';
import MoveToProjectModal from './MoveToProjectModal';
import Icon from './Icon';
import './Inbox.css';

// Срок записи словами: «Сегодня», «Завтра», «Просрочено · 14 окт.» — как в Todoist
function DueChip({ date }) {
  const { t, lang } = useLanguage();
  if (!date) return null;
  const days = daysUntil(date);
  let label = formatDate(date, lang);
  let cls = 'chip';
  let icon = 'calendar';
  if (days < 0) { label = `${t('inboxOverdue')} · ${label}`; cls = 'chip chip-danger'; icon = 'alert'; }
  else if (days === 0) { label = t('inboxToday'); cls = 'chip chip-warning'; icon = 'clock'; }
  else if (days === 1) { label = t('inboxTomorrow'); }
  return <span className={cls}><Icon name={icon} size={12} />{label}</span>;
}

function EditRow({ item, onSave, onCancel }) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description || '');
  const [dueDate, setDueDate] = useState(item.due_date || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    const ok = await onSave({ title, description, dueDate: dueDate || null });
    if (!ok) setSaving(false);
  };

  return (
    <form className="inbox-edit" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <label htmlFor={`inbox-edit-${item.id}`} className="visually-hidden">{t('taskTitleLabel')}</label>
      <input id={`inbox-edit-${item.id}`} className="inbox-edit-title" value={title} maxLength={255} autoFocus onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor={`inbox-edit-desc-${item.id}`} className="visually-hidden">{t('taskDescLabel')}</label>
      <textarea id={`inbox-edit-desc-${item.id}`} rows={2} value={description} placeholder={t('quickAddDescPlaceholder')} onChange={(e) => setDescription(e.target.value)} />
      <div className="inbox-edit-bar">
        <label className="quick-add-option" title={t('quickAddDueTitle')}>
          <Icon name="calendar" size={15} />
          <span className="visually-hidden">{t('quickAddDueTitle')}</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <div className="inbox-edit-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>{t('cancel')}</button>
          <button type="submit" className="btn-primary" disabled={!title.trim() || saving}>{t('save')}</button>
        </div>
      </div>
    </form>
  );
}

function Inbox({ user, onLogout }) {
  const { t, lang } = useLanguage();
  const { notify, confirm } = useFeedback();
  const inbox = useInbox();
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ active: 0, completed: 0 });
  const [showCompleted, setShowCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const [moving, setMoving] = useState(null); // записи, которые переносим
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await getInbox(showCompleted);
      setItems(data.items);
      setCounts(data.counts);
      setLoadError('');
    } catch (err) {
      setLoadError(apiError(err, t, 'inboxFetchError'));
    } finally {
      setLoading(false);
    }
  }, [showCompleted, t]);

  useEffect(() => { load(); }, [load, inbox?.change.version]);

  const active = items.filter(i => !i.completed_at);
  const done = items.filter(i => i.completed_at);
  const changed = () => { load(); inbox?.refreshCount(); };

  const toggleComplete = async (item) => {
    try {
      await updateInboxItem(item.id, { completed: !item.completed_at });
      if (!item.completed_at) notify.success(t('inboxCompleted', { title: item.title }));
      changed();
    } catch (err) {
      notify.error(apiError(err, t, 'inboxSaveError'));
    }
  };

  const save = async (item, patch) => {
    try {
      await updateInboxItem(item.id, patch);
      setEditingId(null);
      changed();
      return true;
    } catch (err) {
      notify.error(apiError(err, t, 'inboxSaveError'));
      return false;
    }
  };

  const remove = async (list) => {
    const ok = await confirm({
      title: list.length === 1 ? t('inboxDeleteTitleOne') : t('inboxDeleteTitleMany', { count: list.length }),
      message: list.length === 1 ? t('inboxDeleteTextOne', { title: list[0].title }) : t('inboxDeleteTextMany'),
      confirmLabel: t('delete'),
      danger: true
    });
    if (!ok) return;
    try {
      for (const item of list) await deleteInboxItem(item.id);
      notify.success(list.length === 1 ? t('inboxDeletedOne') : t('inboxDeletedMany', { count: list.length }));
      setSelected([]);
      changed();
    } catch (err) {
      notify.error(apiError(err, t, 'inboxSaveError'));
      changed();
    }
  };

  const toggleSelected = (id) => setSelected(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
  const exitSelect = () => { setSelectMode(false); setSelected([]); };
  const selectedItems = active.filter(i => selected.includes(i.id));

  const onMoved = (projectId) => {
    setMoving(null);
    setSelected([]);
    setSelectMode(false);
    inbox?.notifyChanged([projectId]);
  };

  const renderItem = (item) => {
    const isDone = !!item.completed_at;
    if (editingId === item.id) {
      return (
        <li key={item.id} className="inbox-item inbox-item-editing">
          <EditRow item={item} onSave={(patch) => save(item, patch)} onCancel={() => setEditingId(null)} />
        </li>
      );
    }
    const isSelected = selected.includes(item.id);
    return (
      <li key={item.id} className={`inbox-item ${isDone ? 'inbox-item-done' : ''} ${isSelected ? 'inbox-item-selected' : ''}`}>
        {selectMode && !isDone ? (
          <input
            type="checkbox"
            className="inbox-select"
            checked={isSelected}
            onChange={() => toggleSelected(item.id)}
            aria-label={t('inboxSelectItem', { title: item.title })}
          />
        ) : (
          <button
            type="button"
            className={`inbox-check ${isDone ? 'inbox-check-on' : ''}`}
            onClick={() => toggleComplete(item)}
            aria-pressed={isDone}
            aria-label={isDone ? t('inboxUncomplete', { title: item.title }) : t('inboxComplete', { title: item.title })}
            title={isDone ? t('inboxUncompleteShort') : t('inboxCompleteShort')}
          >
            <Icon name="check" size={13} />
          </button>
        )}

        <div className="inbox-item-body">
          {isDone || selectMode ? (
            <span className="inbox-item-title">{item.title}</span>
          ) : (
            <button type="button" className="inbox-item-title inbox-item-title-btn" onClick={() => setEditingId(item.id)} title={t('inboxEditHint')}>
              {item.title}
            </button>
          )}
          {item.description && <p className="inbox-item-desc">{item.description}</p>}
          <div className="inbox-item-meta">
            <DueChip date={isDone ? null : item.due_date} />
            {item.source === 'voice' && <span className="chip"><Icon name="mic" size={12} />{t('inboxByVoice')}</span>}
            <span className="inbox-item-added">{t('inboxAdded', { date: formatDate(item.created_at, lang) })}</span>
          </div>
        </div>

        {!isDone && !selectMode && (
          <div className="inbox-item-actions">
            <button type="button" className="btn-small inbox-move-btn" onClick={() => setMoving([item])}>
              <Icon name="arrow-right" size={14} />
              <span>{t('inboxMove')}</span>
            </button>
            <button type="button" className="btn-icon" onClick={() => setEditingId(item.id)} aria-label={t('inboxEdit', { title: item.title })} title={t('inboxEditShort')}>
              <Icon name="pencil" size={15} />
            </button>
            <button type="button" className="btn-icon btn-small-danger" onClick={() => remove([item])} aria-label={t('inboxDelete', { title: item.title })} title={t('delete')}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="dashboard inbox-page">
      <AppHeader user={user} onLogout={onLogout} />
      <main className="dashboard-main inbox-main">
        <div className="inbox-head">
          <div>
            <h1 className="inbox-heading">
              <Icon name="inbox" size={24} />
              {t('inboxTitle')}
              {counts.active > 0 && <span className="count-badge">{counts.active}</span>}
            </h1>
            <p className="inbox-intro">{t('inboxIntro')}</p>
          </div>
          <div className="inbox-head-actions">
            {inbox?.voiceEnabled && (
              <button type="button" className="btn-secondary" onClick={inbox.openVoice} title={t('voiceOpenTitle')}>
                <Icon name="mic" size={16} />
                {t('voiceButton')}
              </button>
            )}
            {active.length > 1 && (
              selectMode
                ? <button type="button" className="btn-secondary" onClick={exitSelect}>{t('inboxSelectDone')}</button>
                : <button type="button" className="btn-secondary" onClick={() => setSelectMode(true)}>{t('inboxSelect')}</button>
            )}
          </div>
        </div>

        {loading ? (
          <p className="inbox-loading" role="status">{t('loading')}</p>
        ) : loadError ? (
          <div className="page-error" role="alert">
            <p className="page-error-title">{loadError}</p>
            <div className="page-error-actions"><button type="button" className="btn-primary" onClick={load}>{t('retry')}</button></div>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <ul className="inbox-list">{active.map(renderItem)}</ul>
            )}

            {adding ? (
              <div className="inbox-add-form">
                <QuickAddForm
                  compact
                  onCancel={() => setAdding(false)}
                  onAdded={(ids) => inbox?.notifyChanged(ids)}
                  voiceEnabled={false}
                />
              </div>
            ) : !selectMode && (
              <button type="button" className="inbox-add" onClick={() => setAdding(true)}>
                <span className="inbox-add-plus"><Icon name="plus" size={14} /></span>
                {t('inboxAddTask')}
              </button>
            )}

            {active.length === 0 && !adding && (
              <div className="empty-state inbox-empty">
                <div className="empty-state-icon"><Icon name="inbox" size={26} /></div>
                <p className="empty-state-title">{t('inboxEmptyTitle')}</p>
                <p>{t('inboxEmptyText')}</p>
              </div>
            )}

            {counts.completed > 0 && (
              <div className="inbox-completed">
                <button type="button" className="btn-link" onClick={() => setShowCompleted(v => !v)} aria-expanded={showCompleted}>
                  {showCompleted ? t('inboxHideCompleted') : t('inboxShowCompleted', { count: counts.completed })}
                </button>
                {showCompleted && done.length > 0 && <ul className="inbox-list inbox-list-done">{done.map(renderItem)}</ul>}
              </div>
            )}

            <p className="inbox-shortcuts">{t('inboxShortcuts')}</p>
          </>
        )}
      </main>

      {selectMode && (
        <div className="inbox-bulk" role="region" aria-label={t('inboxBulkLabel')}>
          <span className="inbox-bulk-count">{t('inboxSelectedCount', { count: selected.length })}</span>
          <button type="button" className="btn-link" onClick={() => setSelected(selected.length === active.length ? [] : active.map(i => i.id))}>
            {selected.length === active.length ? t('inboxSelectNone') : t('inboxSelectAll')}
          </button>
          <div className="inbox-bulk-actions">
            <button type="button" className="btn-secondary btn-small-danger" disabled={!selected.length} onClick={() => remove(selectedItems)}>
              <Icon name="trash" size={15} />{t('delete')}
            </button>
            <button type="button" className="btn-primary" disabled={!selected.length} onClick={() => setMoving(selectedItems)}>
              <Icon name="arrow-right" size={15} />{t('inboxMoveSelected')}
            </button>
          </div>
        </div>
      )}

      {moving && <MoveToProjectModal items={moving} onClose={() => setMoving(null)} onMoved={onMoved} />}
    </div>
  );
}

export default Inbox;

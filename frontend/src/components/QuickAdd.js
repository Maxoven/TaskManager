import React, { useMemo, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { captureTasks } from '../services/api';
import { parseQuickAdd, projectQueryAtCursor } from '../utils/quickAdd';
import { formatDate } from '../utils/date';
import useProjectOptions from '../utils/useProjectOptions';
import apiError from '../utils/apiError';
import Modal from './Modal';
import ProjectSelect from './ProjectSelect';
import Icon from './Icon';
import './Capture.css';

const MAX_SUGGESTIONS = 6;

// Форма быстрого добавления, как Quick Add в Todoist: одна строка, из которой сами
// распознаются срок («завтра», «в пятницу», «20 октября») и проект («#Офис»).
// Используется в окне (клавиша Q) и прямо на странице «Входящие».
export function QuickAddForm({
  initialText = '', defaultProjectId = null, autoFocus = true, onAdded, onCancel, voiceEnabled, onVoice, compact = false
}) {
  const { t, lang } = useLanguage();
  const { notify } = useFeedback();
  const { projects } = useProjectOptions();
  const [text, setText] = useState(initialText);
  const [description, setDescription] = useState('');
  const [skipDate, setSkipDate] = useState(false);
  const [manualDate, setManualDate] = useState('');
  const [destination, setDestination] = useState(defaultProjectId);
  const [cursor, setCursor] = useState(initialText.length);
  const [highlight, setHighlight] = useState(0);
  // «#» уже превращён в проект — подсказку для него больше не показываем
  const [pickedHashAt, setPickedHashAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const parsed = useMemo(() => parseQuickAdd(text, { projects, skipDate }), [text, projects, skipDate]);
  const dueDate = manualDate || parsed.dueDate;
  const projectId = parsed.project ? parsed.project.id : destination;
  const projectName = projectId ? projects.find(p => p.id === projectId)?.name : null;

  // Подсказка проектов после «#»
  const hashQuery = projectQueryAtCursor(text, cursor);
  const suggestions = hashQuery
    ? projects.filter(p => p.name.toLowerCase().includes(hashQuery.query.trim().toLowerCase())).slice(0, MAX_SUGGESTIONS)
    : [];
  const showSuggestions = suggestions.length > 0 && hashQuery.start !== pickedHashAt;

  const pickProject = (project) => {
    const before = text.slice(0, hashQuery.start);
    const after = text.slice(cursor).replace(/^\S*/, '');
    const next = `${before}#${project.name} ${after.trimStart()}`;
    setText(next);
    setPickedHashAt(hashQuery.start);
    const pos = before.length + project.name.length + 2;
    setCursor(pos);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(pos, pos); });
  };

  const reset = () => {
    setText(''); setDescription(''); setSkipDate(false); setManualDate(''); setError(''); setPickedHashAt(null);
    setCursor(0);
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (saving) return;
    if (!parsed.title) { setError(t('quickAddTitleRequired')); inputRef.current?.focus(); return; }
    setSaving(true);
    setError('');
    try {
      await captureTasks([{ title: parsed.title, description, dueDate: dueDate || null, projectId: projectId || null }]);
      notify.success(projectName ? t('quickAddAddedToProject', { project: projectName }) : t('quickAddAddedToInbox'));
      onAdded?.(projectId ? [projectId] : []);
      reset();
      inputRef.current?.focus();
    } catch (err) {
      setError(apiError(err, t, 'inboxSaveError'));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (showSuggestions) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickProject(suggestions[Math.min(highlight, suggestions.length - 1)]); return; }
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(e);
  };

  const syncCursor = (e) => setCursor(e.target.selectionStart ?? e.target.value.length);

  return (
    <form className={`quick-add ${compact ? 'quick-add-compact' : ''}`} onSubmit={submit}>
      <div className="quick-add-field">
        <label htmlFor="quick-add-title" className="visually-hidden">{t('quickAddLabel')}</label>
        <input
          id="quick-add-title"
          ref={inputRef}
          className="quick-add-title"
          value={text}
          autoFocus={autoFocus}
          autoComplete="off"
          maxLength={400}
          placeholder={t('quickAddPlaceholder')}
          onChange={(e) => { setText(e.target.value); syncCursor(e); setHighlight(0); setError(''); }}
          onKeyDown={onKeyDown}
          onKeyUp={syncCursor}
          onClick={syncCursor}
          role="combobox"
          aria-expanded={showSuggestions}
          aria-controls="quick-add-projects"
          aria-autocomplete="list"
        />
        {showSuggestions && (
          <ul className="quick-add-suggestions" id="quick-add-projects" role="listbox">
            {suggestions.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === highlight}>
                <button type="button" className={i === highlight ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); pickProject(p); }}>
                  <Icon name="folder" size={14} />
                  <span>{p.name}</span>
                  {p.team && <span className="quick-add-suggestion-team">{p.team}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(parsed.dateText || parsed.project || (parsed.unknownProject && !hashQuery)) && (
        <div className="quick-add-tokens" aria-live="polite">
          {parsed.dateText && !manualDate && (
            <span className="chip chip-token">
              <Icon name="calendar" size={12} />
              {formatDate(parsed.dueDate, lang)}
              <button type="button" onClick={() => setSkipDate(true)} aria-label={t('quickAddKeepDateAsText', { text: parsed.dateText })} title={t('quickAddKeepDateAsText', { text: parsed.dateText })}>
                <Icon name="x" size={12} />
              </button>
            </span>
          )}
          {parsed.project && (
            <span className="chip chip-token"><Icon name="folder" size={12} />{parsed.project.name}</span>
          )}
          {parsed.unknownProject && !hashQuery && (
            <span className="field-hint">{t('quickAddUnknownProject', { name: parsed.unknownProject })}</span>
          )}
        </div>
      )}

      {!compact && (
        <>
          <label htmlFor="quick-add-desc" className="visually-hidden">{t('taskDescLabel')}</label>
          <textarea
            id="quick-add-desc"
            className="quick-add-desc"
            rows={2}
            value={description}
            placeholder={t('quickAddDescPlaceholder')}
            onChange={(e) => setDescription(e.target.value)}
          />
        </>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}

      <div className="quick-add-bar">
        <div className="quick-add-options">
          <label className="quick-add-option" title={t('quickAddDueTitle')}>
            <Icon name="calendar" size={15} />
            <span className="visually-hidden">{t('quickAddDueTitle')}</span>
            <input type="date" value={manualDate || parsed.dueDate || ''} onChange={(e) => setManualDate(e.target.value)} />
          </label>
          {!parsed.project && (
            <label className="quick-add-option" title={t('quickAddWhere')}>
              <Icon name={destination ? 'folder' : 'inbox'} size={15} />
              <span className="visually-hidden">{t('quickAddWhere')}</span>
              <ProjectSelect projects={projects} value={destination} onChange={setDestination} withInbox />
            </label>
          )}
        </div>
        <div className="quick-add-actions">
          {voiceEnabled && onVoice && (
            <button type="button" className="btn-ghost quick-add-voice" onClick={onVoice} title={t('voiceOpenTitle')}>
              <Icon name="mic" size={16} />
              <span>{t('voiceShort')}</span>
            </button>
          )}
          {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>{t('cancel')}</button>}
          <button type="submit" className="btn-primary" disabled={saving || !parsed.title}>
            {saving ? t('saving') : t('quickAddSubmit')}
          </button>
        </div>
      </div>
      {!compact && <p className="quick-add-help">{t('quickAddHelp')}</p>}
    </form>
  );
}

// Окно быстрого добавления (клавиша Q или «+» в шапке)
function QuickAdd({ initialText, defaultProjectId, voiceEnabled, onVoice, onClose, onAdded }) {
  const { t } = useLanguage();
  return (
    <Modal title={t('quickAddTitle')} onClose={onClose} className="quick-add-modal">
      <QuickAddForm
        initialText={initialText}
        defaultProjectId={defaultProjectId}
        voiceEnabled={voiceEnabled}
        onVoice={() => { onClose(); onVoice(); }}
        onCancel={onClose}
        onAdded={(ids) => { onAdded(ids); onClose(); }}
      />
    </Modal>
  );
}

export default QuickAdd;

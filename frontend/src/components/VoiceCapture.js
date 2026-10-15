import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { captureTasks, parseVoiceTasks } from '../services/api';
import useProjectOptions from '../utils/useProjectOptions';
import apiError from '../utils/apiError';
import Modal from './Modal';
import ProjectSelect from './ProjectSelect';
import Icon from './Icon';
import './Capture.css';

// Голосовой ввод задач — как Ramble в Todoist. Человек говорит свободно, браузер распознаёт речь,
// а после каждой паузы ИИ перечитывает всё сказанное и обновляет список задач. Поправки голосом
// («нет, я имел в виду…», «удали это») работают, потому что разбирается вся запись целиком.
// «Это всё» / «That's all» — закончить. Перед добавлением задачи можно поправить и снять галочки.
// Звук нигде не сохраняется: сохраняются только задачи.

const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const PARSE_DELAY_MS = 900;
const STOP_PHRASE = /(?:^|[\s,.!?])(?:это вс[её]|вот и вс[её]|на этом вс[её]|that'?s all|that is all)[\s.!?]*$/i;

let nextKey = 1;
const toRow = (task, defaultProjectId) => ({
  key: nextKey++,
  selected: true,
  title: task.title,
  description: task.description || '',
  dueDate: task.due_date || '',
  projectId: task.project_id || defaultProjectId || null
});

function VoiceCapture({ defaultProjectId, onClose, onAdded }) {
  const { t, lang } = useLanguage();
  const { notify, confirm } = useFeedback();
  const { projects } = useProjectOptions();
  const supported = !!SpeechRecognition;

  const [phase, setPhase] = useState(supported ? 'listening' : 'typing'); // listening | paused | typing
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [rows, setRows] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const recognitionRef = useRef(null);
  const wantListening = useRef(supported);
  const finalRef = useRef('');
  const parseSeq = useRef(0);
  const parseTimer = useRef(null);
  const editedRef = useRef(false); // человек уже правил список — не перезаписываем его

  const runParse = useCallback(async (transcript) => {
    const seq = ++parseSeq.current;
    if (!transcript.trim()) { setRows([]); return; }
    setParsing(true);
    try {
      const { data } = await parseVoiceTasks(transcript, defaultProjectId);
      if (seq !== parseSeq.current || editedRef.current) return;
      setRows(data.tasks.map(task => toRow(task, defaultProjectId)));
      setError('');
    } catch (err) {
      if (seq === parseSeq.current) setError(apiError(err, t, 'voiceParseError'));
    } finally {
      if (seq === parseSeq.current) setParsing(false);
    }
  }, [defaultProjectId, t]);

  const scheduleParse = useCallback((transcript) => {
    clearTimeout(parseTimer.current);
    parseTimer.current = setTimeout(() => runParse(transcript), PARSE_DELAY_MS);
  }, [runParse]);

  const stopListening = useCallback((nextPhase = 'paused') => {
    wantListening.current = false;
    try { recognitionRef.current?.stop(); } catch (e) { /* уже остановлено */ }
    setInterim('');
    setPhase(nextPhase);
  }, []);

  const startListening = useCallback(() => {
    if (!supported) return;
    editedRef.current = false;
    wantListening.current = true;
    setError('');
    setPhase('listening');
    const rec = new SpeechRecognition();
    rec.lang = lang === 'en' ? 'en-US' : 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let newFinal = '';
      let newInterim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) newFinal += piece; else newInterim += piece;
      }
      if (newFinal) {
        finalRef.current = `${finalRef.current} ${newFinal}`.replace(/\s+/g, ' ').trim();
        setFinalText(finalRef.current);
        if (STOP_PHRASE.test(finalRef.current)) {
          stopListening();
          clearTimeout(parseTimer.current);
          runParse(finalRef.current);
          return;
        }
        scheduleParse(finalRef.current);
      }
      setInterim(newInterim);
    };
    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      wantListening.current = false;
      setPhase('paused');
      setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? t('voiceMicDenied')
        : t('voiceRecognitionError'));
    };
    // Браузер сам завершает распознавание после тишины — продолжаем, пока человек не нажал «Готово»
    rec.onend = () => {
      if (wantListening.current) {
        try { rec.start(); } catch (e) { setPhase('paused'); }
      }
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch (e) { setPhase('paused'); setError(t('voiceRecognitionError')); }
  }, [supported, lang, t, scheduleParse, runParse, stopListening]);

  useEffect(() => {
    if (supported) startListening();
    return () => {
      wantListening.current = false;
      clearTimeout(parseTimer.current);
      try { recognitionRef.current?.abort(); } catch (e) { /* ничего */ }
    };
    // Запускаем один раз при открытии
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    stopListening();
    clearTimeout(parseTimer.current);
    runParse(finalRef.current);
  };

  const parseTyped = () => {
    editedRef.current = false;
    finalRef.current = finalText;
    runParse(finalText);
  };

  const updateRow = (key, patch) => {
    editedRef.current = true;
    setRows(list => list.map(r => (r.key === key ? { ...r, ...patch } : r)));
  };

  const selected = rows.filter(r => r.selected && r.title.trim());

  const close = async () => {
    if (selected.length > 0 && !saving) {
      const ok = await confirm({
        title: t('voiceDiscardTitle'),
        message: t('voiceDiscardText', { count: selected.length }),
        confirmLabel: t('voiceDiscardConfirm'),
        cancelLabel: t('voiceDiscardCancel'),
        danger: true
      });
      if (!ok) return;
    }
    onClose();
  };

  const add = async () => {
    if (selected.length === 0 || saving) return;
    stopListening();
    clearTimeout(parseTimer.current);
    setSaving(true);
    try {
      await captureTasks(selected.map(r => ({
        title: r.title.trim(), description: r.description, dueDate: r.dueDate || null, projectId: r.projectId
      })), 'voice');
      const toInbox = selected.filter(r => !r.projectId).length;
      notify.success(toInbox === selected.length
        ? t('voiceAddedToInbox', { count: selected.length })
        : t('voiceAdded', { count: selected.length }));
      onAdded([...new Set(selected.map(r => r.projectId).filter(Boolean))]);
      onClose();
    } catch (err) {
      setError(apiError(err, t, 'inboxSaveError'));
      setSaving(false);
    }
  };

  const listening = phase === 'listening';
  const transcriptShown = `${finalText}${interim ? ` ${interim}` : ''}`.trim();

  return (
    <Modal title={t('voiceTitle')} onClose={close} className="voice-modal">
      <div className="voice-capture">
        <div className={`voice-stage ${listening ? 'voice-stage-live' : ''}`}>
          {supported && (
            <button
              type="button"
              className={`voice-mic ${listening ? 'voice-mic-live' : ''}`}
              onClick={listening ? finish : startListening}
              aria-pressed={listening}
              aria-label={listening ? t('voiceStop') : t('voiceResume')}
            >
              <Icon name="mic" size={26} />
            </button>
          )}
          <div className="voice-stage-text">
            <p className="voice-status" role="status">
              {listening ? t('voiceListening') : supported ? t('voicePaused') : t('voiceUnsupported')}
            </p>
            <p className="voice-hint">{listening ? t('voiceHintListening') : supported ? t('voiceHintPaused') : t('voiceHintTyping')}</p>
          </div>
        </div>

        {listening ? (
          <p className={`voice-transcript ${transcriptShown ? '' : 'voice-transcript-empty'}`} aria-live="polite">
            {transcriptShown || t('voiceTranscriptEmpty')}
            {interim && <span className="voice-interim" aria-hidden="true" />}
          </p>
        ) : (
          <div className="voice-typed">
            <label htmlFor="voice-text" className="visually-hidden">{t('voiceTranscriptLabel')}</label>
            <textarea
              id="voice-text"
              rows={3}
              value={finalText}
              placeholder={t('voiceTypedPlaceholder')}
              onChange={(e) => { setFinalText(e.target.value); finalRef.current = e.target.value; }}
              autoFocus={!supported}
            />
            <button type="button" className="btn-small" onClick={parseTyped} disabled={!finalText.trim() || parsing}>
              <Icon name="sparkles" size={14} />
              {rows.length ? t('voiceReparse') : t('voiceParse')}
            </button>
          </div>
        )}

        {error && <p className="field-error" role="alert">{error}</p>}

        <section className="voice-results" aria-label={t('voiceResultsLabel')}>
          <div className="voice-results-head">
            <h3>{t('voiceResultsTitle')}</h3>
            {parsing && <span className="voice-parsing"><span className="spinner" aria-hidden="true" />{t('voiceParsing')}</span>}
          </div>
          {rows.length === 0 ? (
            <p className="voice-results-empty">{parsing ? '' : t('voiceResultsEmpty')}</p>
          ) : (
            <ul className="voice-task-list">
              {rows.map(row => (
                <li key={row.key} className={`voice-task ${row.selected ? '' : 'voice-task-off'}`}>
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => updateRow(row.key, { selected: e.target.checked })}
                    aria-label={t('voiceTaskInclude', { title: row.title })}
                  />
                  <div className="voice-task-body">
                    <input
                      className="voice-task-title"
                      value={row.title}
                      maxLength={255}
                      onChange={(e) => updateRow(row.key, { title: e.target.value })}
                      aria-label={t('taskTitleLabel')}
                    />
                    {row.description && <p className="voice-task-desc">{row.description}</p>}
                    <div className="voice-task-meta">
                      <label className="quick-add-option" title={t('quickAddDueTitle')}>
                        <Icon name="calendar" size={14} />
                        <span className="visually-hidden">{t('quickAddDueTitle')}</span>
                        <input type="date" value={row.dueDate} onChange={(e) => updateRow(row.key, { dueDate: e.target.value })} />
                      </label>
                      <label className="quick-add-option" title={t('quickAddWhere')}>
                        <Icon name={row.projectId ? 'folder' : 'inbox'} size={14} />
                        <span className="visually-hidden">{t('quickAddWhere')}</span>
                        <ProjectSelect projects={projects} value={row.projectId} onChange={(v) => updateRow(row.key, { projectId: v })} withInbox />
                      </label>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="voice-privacy">{t('voicePrivacy')}</p>

        <div className="modal-actions">
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={close}>{t('cancel')}</button>
            <button type="button" className="btn-primary" onClick={add} disabled={selected.length === 0 || saving}>
              {saving ? t('saving') : t('voiceAddCount', { count: selected.length })}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default VoiceCapture;

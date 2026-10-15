import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getInboxCount, getAssistant } from '../services/api';
import QuickAdd from '../components/QuickAdd';
import VoiceCapture from '../components/VoiceCapture';

// «Входящие» и быстрый ввод задач — как Inbox, Quick Add и Ramble в Todoist:
//   Q        — быстро добавить задачу (по умолчанию во «Входящие»);
//   Shift+Q  — надиктовать задачи голосом.
// Открыто из проекта — задачи по умолчанию попадают в этот проект.
const InboxContext = createContext(null);

// Не перехватываем клавиши, когда человек печатает или открыто окно
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function InboxProvider({ enabled, children }) {
  const [count, setCount] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [defaultProjectId, setDefaultProjectId] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'quick' | 'voice', text? }
  // Меняется после каждого добавления/переноса — страницы перечитывают свои данные
  const [change, setChange] = useState({ version: 0, projectIds: [] });

  const refreshCount = useCallback(() => {
    if (!enabled) return;
    getInboxCount().then(({ data }) => setCount(data.count)).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setCount(0); setVoiceEnabled(false); return; }
    refreshCount();
    // Разбор голоса делает ИИ — без ключа на сервере кнопку не показываем
    getAssistant().then(({ data }) => setVoiceEnabled(!!data.enabled)).catch(() => setVoiceEnabled(false));
  }, [enabled, refreshCount]);

  const notifyChanged = useCallback((projectIds = []) => {
    setChange(prev => ({ version: prev.version + 1, projectIds }));
    refreshCount();
  }, [refreshCount]);

  const openQuickAdd = useCallback((text = '') => setDialog({ kind: 'quick', text }), []);
  const openVoice = useCallback(() => setDialog({ kind: 'voice' }), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.key !== 'q' && e.key !== 'Q' && e.code !== 'KeyQ') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || document.querySelector('.modal-overlay')) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (voiceEnabled) openVoice();
      } else {
        openQuickAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, voiceEnabled, openQuickAdd, openVoice]);

  const value = useMemo(() => ({
    count, voiceEnabled, defaultProjectId, setDefaultProjectId, change, notifyChanged, refreshCount,
    openQuickAdd, openVoice
  }), [count, voiceEnabled, defaultProjectId, change, notifyChanged, refreshCount, openQuickAdd, openVoice]);

  return (
    <InboxContext.Provider value={value}>
      {children}
      {dialog?.kind === 'quick' && (
        <QuickAdd
          initialText={dialog.text}
          defaultProjectId={defaultProjectId}
          voiceEnabled={voiceEnabled}
          onVoice={openVoice}
          onClose={closeDialog}
          onAdded={notifyChanged}
        />
      )}
      {dialog?.kind === 'voice' && (
        <VoiceCapture defaultProjectId={defaultProjectId} onClose={closeDialog} onAdded={notifyChanged} />
      )}
    </InboxContext.Provider>
  );
}

export function useInbox() {
  return useContext(InboxContext);
}

// Страница проекта: пока она открыта, быстрый ввод по умолчанию кладёт задачи в этот проект
export function useInboxDefaultProject(projectId) {
  const inbox = useInbox();
  const setDefault = inbox?.setDefaultProjectId;
  useEffect(() => {
    if (!setDefault) return undefined;
    setDefault(projectId || null);
    return () => setDefault(null);
  }, [projectId, setDefault]);
}

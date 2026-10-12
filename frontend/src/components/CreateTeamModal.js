import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { createTeam } from '../services/api';
import apiError from '../utils/apiError';
import Modal from './Modal';

// Новая команда: только название. Создатель становится владельцем — дальше
// он приглашает людей и назначает роли в настройках команды.
function CreateTeamModal({ onCreated, onClose }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const { data } = await createTeam(name.trim());
      await onCreated(data);
    } catch (err) {
      setError(apiError(err, t, 'teamCreateError'));
      setSaving(false);
    }
  };

  return (
    <Modal title={t('createTeamTitle')} description={t('createTeamIntro')} onClose={onClose} className="create-team-modal">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="team-name">{t('teamNameLabel')} <span className="required-mark" aria-hidden="true">*</span></label>
          <input id="team-name" type="text" autoFocus required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('teamNamePlaceholder')} />
          <p className="field-hint">{t('createTeamNextHint')}</p>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="modal-actions">
          <div className="modal-actions-right">
            <button type="button" onClick={onClose} className="btn-secondary">{t('cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
              {saving ? t('saving') : t('createTeamSubmit')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default CreateTeamModal;

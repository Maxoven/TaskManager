import React, { useId } from 'react';
import { useLanguage } from '../context/LanguageContext';
import Avatar from './Avatar';
import Icon from './Icon';

// «Кто видит проект» — при создании проекта и в окне «Участники».
// Три варианта:
//   selected — только отмеченные люди;
//   team_now — все, кто сейчас в команде (сохраняется как отметки: новые участники проект не увидят);
//   team     — вся команда всегда, включая тех, кто вступит позже.
// Владелец команды видит все проекты всегда; тот, кто настраивает доступ, тоже остаётся в списке.
export const ACCESS_MODES = ['selected', 'team_now', 'team'];

const othersOf = (roster) => roster.filter(m => m.role !== 'owner');

// Начальное значение по проекту с сервера (visibility + has_access у людей команды)
export function accessFromProject(project, roster) {
  if (project.visibility === 'team') return { mode: 'team', ids: new Set(othersOf(roster).map(m => m.id)) };
  const ids = new Set(othersOf(roster).filter(m => m.has_access).map(m => m.id));
  const all = othersOf(roster).every(m => ids.has(m.id));
  return { mode: all && ids.size > 0 ? 'team_now' : 'selected', ids };
}

// Значение для нового проекта: отмечен только сам создатель
export const newProjectAccess = (selfId) => ({ mode: 'selected', ids: new Set(selfId ? [selfId] : []) });

// Что отправить на сервер
export function accessPayload(value) {
  return value.mode === 'team'
    ? { visibility: 'team', memberIds: [] }
    : { visibility: 'selected', memberIds: [...value.ids] };
}

function ProjectAccessPicker({ roster, selfId, value, onChange, disabled = false }) {
  const { t } = useLanguage();
  const name = useId();
  const others = othersOf(roster);
  const owner = roster.find(m => m.role === 'owner');

  const setMode = (mode) => {
    if (mode === 'team_now') onChange({ mode, ids: new Set(others.map(m => m.id)) });
    else onChange({ mode, ids: value.ids });
  };

  const toggle = (id) => {
    const ids = new Set(value.ids);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    // Сняли кого-то в режиме «вся команда сейчас» — это уже выбор отдельных людей
    const all = others.every(m => ids.has(m.id));
    onChange({ mode: all && value.mode === 'team_now' ? 'team_now' : 'selected', ids });
  };

  const checkedCount = others.filter(m => value.ids.has(m.id) || m.id === selfId).length + (owner ? 1 : 0);

  return (
    <fieldset className="access-picker" disabled={disabled}>
      <legend className="access-picker-legend">{t('accessTitle')}</legend>
      <div className="access-options" role="radiogroup">
        {ACCESS_MODES.map(mode => (
          <label key={mode} className={`access-option ${value.mode === mode ? 'is-selected' : ''}`}>
            <input type="radio" name={name} value={mode} checked={value.mode === mode} onChange={() => setMode(mode)} />
            <span className="access-option-text">
              <span className="access-option-title">
                <Icon name={mode === 'selected' ? 'lock' : 'users'} size={15} />
                {t(`accessMode_${mode}`)}
              </span>
              <span className="access-option-hint">{t(`accessModeHint_${mode}`)}</span>
            </span>
          </label>
        ))}
      </div>

      {value.mode === 'team' ? (
        <p className="field-hint access-picker-note">{t('accessTeamNote', { count: roster.length })}</p>
      ) : (
        <>
          <div className="access-list-head">
            <span>{t('accessListTitle')}</span>
            <span className="access-count">{t('accessCount', { count: checkedCount, total: roster.length })}</span>
          </div>
          <ul className="access-list">
            {owner && (
              <li>
                <label className="access-person is-locked">
                  <input type="checkbox" checked disabled readOnly />
                  <Avatar name={owner.name} src={owner.avatar} size="sm" aria-hidden="true" />
                  <span className="access-person-name">{owner.name}{owner.id === selfId && <span className="people-you"> {t('youMark')}</span>}</span>
                  <span className="access-person-note">{t('accessOwnerAlways')}</span>
                </label>
              </li>
            )}
            {others.map(m => {
              const self = m.id === selfId;
              return (
                <li key={m.id}>
                  <label className={`access-person ${self ? 'is-locked' : ''}`}>
                    <input type="checkbox" checked={self || value.ids.has(m.id)} disabled={self} onChange={() => toggle(m.id)} />
                    <Avatar name={m.name} src={m.avatar} size="sm" aria-hidden="true" />
                    <span className="access-person-name">{m.name}{self && <span className="people-you"> {t('youMark')}</span>}</span>
                    <span className="access-person-note">{self ? t('accessSelfAlways') : t(m.role === 'admin' ? 'roleAdmin' : 'roleMember')}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {others.length === 0 && <p className="field-hint">{t('accessNobodyYet')}</p>}
        </>
      )}
    </fieldset>
  );
}

export default ProjectAccessPicker;

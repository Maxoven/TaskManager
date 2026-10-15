import React from 'react';
import { useLanguage } from '../context/LanguageContext';

// Выбор проекта, сгруппированный по командам. withInbox — первым пунктом «Входящие» (value '')
function ProjectSelect({ projects, value, onChange, withInbox = false, placeholder, id, className = '', disabled }) {
  const { t } = useLanguage();
  const teams = [];
  projects.forEach(p => {
    let group = teams.find(g => g.name === p.team);
    if (!group) { group = { name: p.team, items: [] }; teams.push(group); }
    group.items.push(p);
  });
  return (
    <select
      id={id}
      className={className}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      disabled={disabled}
    >
      {withInbox ? <option value="">{t('inboxTitle')}</option> : <option value="" disabled>{placeholder || t('moveChooseProject')}</option>}
      {teams.map(group => (
        group.name
          ? <optgroup key={group.name} label={group.name}>{group.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          : group.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
      ))}
    </select>
  );
}

export default ProjectSelect;

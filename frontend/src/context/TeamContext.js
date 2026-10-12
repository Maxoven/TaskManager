import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getTeams, getTeamInvitations, getProjects, getPendingInvitations } from '../services/api';

// Команды пользователя и выбранная сейчас. Выбор хранится в браузере для каждого
// пользователя отдельно. Кроме команд есть раздел SHARED — проекты, куда человека
// пригласили по одному (гостевой доступ): у них своей команды для него нет.
export const SHARED = 'shared';

const TeamContext = createContext(null);
const storageKey = (userId) => `currentTeam:${userId}`;

function readSaved(userId) {
  try { return localStorage.getItem(storageKey(userId)); } catch (e) { return null; }
}

export function TeamProvider({ userId, children }) {
  const [teams, setTeams] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [sharedCount, setSharedCount] = useState(0);
  const [projectInvitesCount, setProjectInvitesCount] = useState(0);
  const [saved, setSaved] = useState(() => readSaved(userId));
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [teamsRes, invRes, projectsRes, projectInvRes] = await Promise.all([
      getTeams(), getTeamInvitations(), getProjects(), getPendingInvitations()
    ]);
    setTeams(teamsRes.data);
    setInvitations(invRes.data);
    setProjectInvitesCount(projectInvRes.data.length);
    setSharedCount(projectsRes.data.filter(p => p.my_role === 'guest').length);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    setSaved(readSaved(userId));
    setLoaded(false);
    refresh().catch(() => setLoaded(true));
  }, [userId, refresh]);

  // Сохранённая команда могла пропасть (вышли, удалили). Тогда — первая команда с проектами;
  // если проектов нет ни в одной, но есть отдельные (гостевые), — они: человек сразу видит, где работа.
  const current = useMemo(() => {
    if (saved === SHARED && sharedCount > 0) return SHARED;
    const id = Number(saved);
    if (teams.some(t => t.id === id)) return id;
    const withProjects = teams.find(t => t.projects_count > 0);
    if (withProjects) return withProjects.id;
    if (sharedCount > 0) return SHARED;
    return teams[0]?.id ?? null;
  }, [saved, teams, sharedCount]);

  const selectTeam = useCallback((id) => {
    const value = id === SHARED ? SHARED : String(id);
    setSaved(value);
    try { localStorage.setItem(storageKey(userId), value); } catch (e) { /* localStorage недоступен */ }
  }, [userId]);

  const currentTeam = typeof current === 'number' ? teams.find(t => t.id === current) || null : null;

  const invitesTotal = invitations.length + projectInvitesCount;
  const value = { teams, invitations, invitesTotal, sharedCount, current, currentTeam, selectTeam, refresh, loaded };
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeams() {
  return useContext(TeamContext);
}

// Права в команде: владелец и админы ведут проекты и людей, участники — работают с задачами
export const canManageRole = (role) => role === 'owner' || role === 'admin';

// Буква на знаке команды: «Команда Мария Иванова» → «М», «Maria's team» → «M»
export function teamMark(name = '') {
  const clean = String(name).trim()
    .replace(/^(команда|team)\s+/i, '')
    .replace(/['’]s team$/i, '')
    .replace(/^[«"“]/, '');
  return clean || name;
}

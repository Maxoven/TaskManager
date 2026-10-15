import { useEffect, useState } from 'react';
import { getProjects } from '../services/api';

// Проекты, доступные пользователю, — для выбора, куда положить задачу
export default function useProjectOptions() {
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getProjects()
      .then(({ data }) => { if (!cancelled) setProjects(data.map(p => ({ id: p.id, name: p.name, team: p.team_name || '' }))); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);
  return { projects, loaded };
}

import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Язык интерфейса — чтобы сервер отвечал (и писал письма) на нём же
  config.headers['X-Lang'] = localStorage.getItem('lang') || 'ru';
  return config;
});

// Токен истёк или недействителен — выходим и отправляем на страницу входа
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const hadToken = !!localStorage.getItem('token');
    if (error.response?.status === 401 && hadToken) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

// Auth
export const register = (data) => api.post('/auth/register', data);
export const login = (data) => api.post('/auth/login', data);
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email });
export const resetPassword = (token, password) => api.post('/auth/reset-password', { token, password });
export const checkResetToken = (token) => api.get(`/auth/reset-password/${token}`);
export const saveLanguage = (language) => api.patch('/auth/language', { language });

// Projects
export const getProjects = () => api.get('/projects');
export const getProject = (id) => api.get(`/projects/${id}`);
export const createProject = (data) => api.post('/projects', data);
export const updateProject = (id, data) => api.patch(`/projects/${id}`, data);
// Кто видит проект: { visibility: 'team' | 'selected', memberIds }
export const updateProjectAccess = (id, data) => api.put(`/projects/${id}/access`, data);
export const deleteProject = (id) => api.delete(`/projects/${id}`);
export const reorderProjects = (projectIds) => api.post('/projects/reorder', { projectIds });
export const inviteToProject = (projectId, email) =>
  api.post(`/projects/${projectId}/invite`, { email });
export const respondToInvitation = (projectId, action) =>
  api.patch(`/projects/${projectId}/invitation/${action}`);
export const getPendingInvitations = () => api.get('/projects/invitations/pending');
export const removeProjectMember = (projectId, userId) => api.delete(`/projects/${projectId}/members/${userId}`);
export const leaveProject = (projectId) => api.post(`/projects/${projectId}/leave`);

// Tasks
export const createTask = (data) => api.post('/tasks', data);
export const updateTask = (id, data) => api.patch(`/tasks/${id}`, data);
export const deleteTask = (id) => api.delete(`/tasks/${id}`);
export const getMyTasks = () => api.get('/tasks/my');

// Reports
export const getReportByToken = (token) => api.get(`/tasks/report-token/${token}`);
export const submitReportByToken = (token, reportText) =>
  api.post(`/tasks/report-token/${token}`, { reportText });
export const getTaskReports = (taskId) => api.get(`/tasks/${taskId}/reports`);

// Files
export const uploadFile = (taskId, file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post(`/tasks/${taskId}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
export const getTaskAttachments = (taskId) => api.get(`/tasks/${taskId}/attachments`);
export const downloadFile = (taskId, fileId) =>
  api.get(`/tasks/${taskId}/attachments/${fileId}/download`, { responseType: 'blob' });
export const deleteFile = (taskId, fileId) => api.delete(`/tasks/${taskId}/attachments/${fileId}`);

// ИИ-ассистент
export const getAssistant = () => api.get('/assistant');
export const sendAssistantMessage = (text) => api.post('/assistant/messages', { text }, { timeout: 180000 });
export const clearAssistant = () => api.delete('/assistant/messages');

// Команды: у пользователя может быть несколько, роли owner / admin / member
export const getTeams = () => api.get('/teams');
export const createTeam = (name) => api.post('/teams', { name });
export const getTeamDetails = (teamId) => api.get(`/teams/${teamId}`);
export const renameTeam = (teamId, name) => api.patch(`/teams/${teamId}`, { name });
export const deleteTeam = (teamId) => api.delete(`/teams/${teamId}`);
export const inviteToTeam = (teamId, email, role) => api.post(`/teams/${teamId}/members`, { email, role });
export const changeTeamRole = (teamId, userId, role) => api.patch(`/teams/${teamId}/members/${userId}`, { role });
export const removeTeamMember = (teamId, userId) => api.delete(`/teams/${teamId}/members/${userId}`);
export const getTeamInvitations = () => api.get('/teams/invitations');
export const respondToTeamInvitation = (teamId, action) => api.patch(`/teams/invitations/${teamId}/${action}`);

// Профиль
export const getMe = () => api.get('/auth/me');
export const uploadAvatar = (blob) => {
  const formData = new FormData();
  formData.append('avatar', blob, 'avatar');
  return api.post('/auth/avatar', formData);
};
export const deleteAvatar = () => api.delete('/auth/avatar');
// Фото раздаётся без токена — <img> его и не отправит
export const avatarUrl = (file) => (file ? `${API_URL}/avatars/${file}` : null);

// Email verification
export const verifyEmail = (token) => api.get(`/auth/verify-email/${token}`);
export const resendVerification = (email) => api.post('/auth/resend-verification', { email });

export default api;

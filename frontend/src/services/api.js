import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auth
export const register = (data) => api.post('/auth/register', data);
export const login = (data) => api.post('/auth/login', data);
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email });
export const resetPassword = (token, password) => api.post('/auth/reset-password', { token, password });
export const checkResetToken = (token) => api.get(`/auth/reset-password/${token}`);

// Projects
export const getProjects = () => api.get('/projects');
export const getProject = (id) => api.get(`/projects/${id}`);
export const createProject = (data) => api.post('/projects', data);
export const updateProject = (id, data) => api.patch(`/projects/${id}`, data);
export const deleteProject = (id) => api.delete(`/projects/${id}`);
export const reorderProjects = (projectIds) => api.post('/projects/reorder', { projectIds });
export const inviteToProject = (projectId, email) =>
  api.post(`/projects/${projectId}/invite`, { email });
export const respondToInvitation = (projectId, action) =>
  api.patch(`/projects/${projectId}/invitation/${action}`);
export const getPendingInvitations = () => api.get('/projects/invitations/pending');

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

// Team
export const getTeam = () => api.get('/team');
export const addTeamMember = (email) => api.post('/team', { email });
export const removeTeamMember = (memberId) => api.delete(`/team/${memberId}`);
export const getTeamInvitations = () => api.get('/team/invitations');
export const respondToTeamInvitation = (ownerId, action) => api.patch(`/team/invitations/${ownerId}/${action}`);

// Email verification
export const verifyEmail = (token) => api.get(`/auth/verify-email/${token}`);
export const resendVerification = (email) => api.post('/auth/resend-verification', { email });

export default api;

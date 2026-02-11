import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
});

// Добавление токена к каждому запросу
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth
export const register = (data) => api.post('/auth/register', data);
export const login = (data) => api.post('/auth/login', data);

// Projects
export const getProjects = () => api.get('/projects');
export const getProject = (id) => api.get(`/projects/${id}`);
export const createProject = (data) => api.post('/projects', data);
export const deleteProject = (id) => api.delete(`/projects/${id}`);
export const inviteToProject = (projectId, email) => 
  api.post(`/projects/${projectId}/invite`, { email });
export const respondToInvitation = (projectId, action) => 
  api.patch(`/projects/${projectId}/invitation/${action}`);
export const getPendingInvitations = () => api.get('/projects/invitations/pending');

// Tasks
export const createTask = (data) => api.post('/tasks', data);
export const updateTask = (id, data) => api.patch(`/tasks/${id}`, data);
export const deleteTask = (id) => api.delete(`/tasks/${id}`);

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
export const deleteFile = (taskId, fileId) => 
  api.delete(`/tasks/${taskId}/attachments/${fileId}`);

export default api;

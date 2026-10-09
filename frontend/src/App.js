import React, { useState } from 'react';
// Общие стили идут раньше стилей компонентов, чтобы компонент мог их уточнять
import './App.css';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import KanbanBoard from './components/KanbanBoard';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import ReportForm from './components/ReportForm';
import VerifyEmail from './components/VerifyEmail';
import { LanguageProvider } from './context/LanguageContext';
import { FeedbackProvider } from './context/FeedbackContext';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });

  const handleLogin = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  return (
    <LanguageProvider>
      <FeedbackProvider>
      <Router>
        <div className="app">
          <Routes>
            <Route path="/login" element={!token ? <Login onLogin={handleLogin} /> : <Navigate to="/" />} />
            <Route path="/register" element={!token ? <Register /> : <Navigate to="/" />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
            <Route path="/verify-email/:token" element={<VerifyEmail onLogin={handleLogin} />} />
            <Route path="/report/:token" element={<ReportForm />} />
            <Route path="/" element={token ? <Dashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} />
            <Route path="/project/:id" element={token ? <KanbanBoard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} />
          </Routes>
        </div>
      </Router>
      </FeedbackProvider>
    </LanguageProvider>
  );
}

export default App;

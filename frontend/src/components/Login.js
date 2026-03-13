import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { login, resendVerification } from '../services/api';
import './Auth.css';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNeedsVerification(false);
    setLoading(true);
    try {
      const response = await login({ email, password });
      onLogin(response.data.user, response.data.token);
    } catch (err) {
      if (err.response?.data?.needsVerification) {
        setNeedsVerification(true);
      }
      setError(err.response?.data?.error || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendVerification(email);
      setResendMsg('Письмо отправлено! Проверьте почту.');
    } catch {
      setResendMsg('Не удалось отправить письмо');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>Вход в Task Manager</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" />
          </div>
          <div className="form-group">
            <label>Пароль</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Введите пароль" />
          </div>
          {error && <div className="error">{error}</div>}
          {needsVerification && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <span style={{ color: '#888' }}>Не получили письмо? </span>
              <button type="button" onClick={handleResend} style={{ background: 'none', border: 'none', color: '#25b84c', cursor: 'pointer', padding: 0, fontSize: 13, textDecoration: 'underline' }}>
                Отправить повторно
              </button>
              {resendMsg && <span style={{ color: '#25b84c', marginLeft: 8 }}>{resendMsg}</span>}
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
        <p className="auth-link">
          <Link to="/forgot-password" className="forgot-link">Забыли пароль?</Link>
        </p>
        <p className="auth-link">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}

export default Login;

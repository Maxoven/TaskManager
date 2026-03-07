import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { checkResetToken, resetPassword } from '../services/api';
import './Auth.css';

function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [valid, setValid] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    checkResetToken(token)
      .then(() => setValid(true))
      .catch(() => setValid(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка изменения пароля');
    } finally {
      setLoading(false);
    }
  };

  if (valid === null) {
    return <div className="auth-container"><div className="auth-box"><p>Проверка ссылки...</p></div></div>;
  }

  if (!valid) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div style={{ fontSize: '48px', textAlign: 'center' }}>❌</div>
          <h2>Ссылка недействительна</h2>
          <p>Ссылка для сброса пароля истекла или уже была использована.</p>
          <Link to="/forgot-password" className="btn-primary" style={{ display: 'block', textAlign: 'center', marginTop: '16px' }}>
            Запросить новую ссылку
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div className="success-icon">✅</div>
          <h2>Пароль изменён!</h2>
          <p>Вы будете перенаправлены на страницу входа через 3 секунды...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>Новый пароль</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Новый пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Минимум 6 символов"
            />
          </div>
          <div className="form-group">
            <label>Подтвердите пароль</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="Повторите пароль"
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Сохранение...' : 'Сохранить пароль'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ResetPassword;

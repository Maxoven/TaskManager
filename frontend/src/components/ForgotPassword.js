import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../services/api';
import './Auth.css';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка отправки письма');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div className="success-icon">✅</div>
          <h2>Письмо отправлено</h2>
          <p>Если email <strong>{email}</strong> зарегистрирован в системе, вы получите письмо со ссылкой для сброса пароля.</p>
          <p style={{ color: '#888', fontSize: '14px' }}>Ссылка действительна 1 час. Проверьте папку «Спам».</p>
          <Link to="/login" className="btn-primary" style={{ display: 'block', textAlign: 'center', marginTop: '16px' }}>
            Вернуться ко входу
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>Сброс пароля</h1>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          Введите email вашего аккаунта и мы отправим ссылку для сброса пароля.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Отправка...' : 'Отправить ссылку'}
          </button>
        </form>
        <p className="auth-link">
          <Link to="/login">← Назад ко входу</Link>
        </p>
      </div>
    </div>
  );
}

export default ForgotPassword;

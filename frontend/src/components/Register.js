import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { register, resendVerification } from '../services/api';
import './Auth.css';

function Register() {
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Пароли не совпадают'); return;
    }
    if (formData.password.length < 8) {
      setError('Пароль должен содержать минимум 8 символов'); return;
    }

    setLoading(true);
    try {
      await register({ name: formData.name, email: formData.email, password: formData.password });
      setRegistered(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    setResendMsg('');
    try {
      await resendVerification(formData.email);
      setResendMsg('Письмо отправлено повторно!');
    } catch {
      setResendMsg('Не удалось отправить письмо');
    } finally {
      setResendLoading(false);
    }
  };

  if (registered) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
            <h2>Проверьте почту!</h2>
            <p style={{ color: '#555', marginBottom: 8 }}>
              Мы отправили письмо на <strong>{formData.email}</strong>
            </p>
            <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>
              Перейдите по ссылке в письме чтобы подтвердить аккаунт и войти. Ссылка действует 24 часа.
            </p>
            <button onClick={handleResend} disabled={resendLoading} className="btn-secondary" style={{ fontSize: 13 }}>
              {resendLoading ? 'Отправляем...' : 'Отправить письмо повторно'}
            </button>
            {resendMsg && <p style={{ marginTop: 10, fontSize: 13, color: '#25b84c' }}>{resendMsg}</p>}
            <p style={{ marginTop: 24, fontSize: 13 }}>
              <Link to="/login">← Вернуться ко входу</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>Регистрация</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Имя</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} required placeholder="Ваше имя" />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} required placeholder="your@email.com" />
          </div>
          <div className="form-group">
            <label>Пароль</label>
            <input type="password" name="password" value={formData.password} onChange={handleChange} required placeholder="Минимум 8 символов" minLength={8} />
          </div>
          <div className="form-group">
            <label>Подтвердите пароль</label>
            <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} required placeholder="Повторите пароль" />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
          </button>
        </form>
        <p className="auth-link">Уже есть аккаунт? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  );
}

export default Register;

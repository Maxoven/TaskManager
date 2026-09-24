import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { register, resendVerification } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { Logo } from './AppHeader';
import './Auth.css';

function Register() {
  const { t, lang, toggleLang } = useLanguage();
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (formData.password !== formData.confirmPassword) { setError(t('registerPasswordMismatch')); return; }
    if (formData.password.length < 8) { setError(t('registerPasswordShort')); return; }
    setLoading(true);
    try {
      await register({ name: formData.name, email: formData.email, password: formData.password });
      setRegistered(true);
    } catch (err) {
      setError(err.response?.data?.error || t('registerError'));
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    setResendLoading(true); setResendMsg('');
    try { await resendVerification(formData.email); setResendMsg(t('registerResendDone')); }
    catch { setResendMsg(t('registerResendError')); }
    finally { setResendLoading(false); }
  };

  if (registered) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div className="auth-lang-toggle"><Logo size={28} />
            <button onClick={toggleLang} className="lang-btn">{lang === 'ru' ? 'EN' : 'RU'}</button>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
            <h2>{t('registerCheckEmail')}</h2>
            <p style={{ color: '#555', marginBottom: 8 }}>{t('registerEmailSent')} <strong>{formData.email}</strong></p>
            <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>{t('registerEmailHint')}</p>
            <button onClick={handleResend} disabled={resendLoading} className="btn-secondary" style={{ fontSize: 13 }}>
              {resendLoading ? t('registerResendLoading') : t('registerResend')}
            </button>
            {resendMsg && <p style={{ marginTop: 10, fontSize: 13, color: '#25b84c' }}>{resendMsg}</p>}
            <p style={{ marginTop: 24, fontSize: 13 }}><Link to="/login">{t('registerBackToLogin')}</Link></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-lang-toggle"><Logo size={28} />
          <button onClick={toggleLang} className="lang-btn">{lang === 'ru' ? 'EN' : 'RU'}</button>
        </div>
        <h1>{t('registerTitle')}</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('registerName')}</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} required placeholder={t('registerNamePlaceholder')} />
          </div>
          <div className="form-group">
            <label>{t('loginEmail')}</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} required placeholder="your@email.com" />
          </div>
          <div className="form-group">
            <label>{t('loginPassword')}</label>
            <input type="password" name="password" value={formData.password} onChange={handleChange} required placeholder={t('registerPasswordPlaceholder')} minLength={8} />
          </div>
          <div className="form-group">
            <label>{t('registerConfirmPassword')}</label>
            <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} required placeholder={t('registerConfirmPlaceholder')} />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? t('registerLoading') : t('registerBtn')}
          </button>
        </form>
        <p className="auth-link">{t('registerHaveAccount')} <Link to="/login">{t('registerLoginLink')}</Link></p>
      </div>
    </div>
  );
}

export default Register;

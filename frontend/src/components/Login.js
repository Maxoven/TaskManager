import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { login, resendVerification } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import './Auth.css';

function Login({ onLogin }) {
  const { t, lang, toggleLang } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setNeedsVerification(false); setLoading(true);
    try {
      const response = await login({ email, password });
      onLogin(response.data.user, response.data.token);
    } catch (err) {
      if (err.response?.data?.needsVerification) setNeedsVerification(true);
      setError(err.response?.data?.error || t('loginError'));
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    try { await resendVerification(email); setResendMsg(t('loginResendDone')); }
    catch { setResendMsg(t('loginError')); }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-lang-toggle">
          <button onClick={toggleLang} className="lang-btn">{lang === 'ru' ? 'EN' : 'RU'}</button>
        </div>
        <h1>{t('loginTitle')}</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('loginEmail')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" />
          </div>
          <div className="form-group">
            <label>{t('loginPassword')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder={t('loginPassword')} />
          </div>
          {error && <div className="error">{error}</div>}
          {needsVerification && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <span style={{ color: '#888' }}>{t('loginNotReceived')}</span>
              <button type="button" onClick={handleResend} style={{ background: 'none', border: 'none', color: '#25b84c', cursor: 'pointer', padding: 0, fontSize: 13, textDecoration: 'underline' }}>
                {t('loginResend')}
              </button>
              {resendMsg && <span style={{ color: '#25b84c', marginLeft: 8 }}>{resendMsg}</span>}
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? t('loginLoading') : t('loginBtn')}
          </button>
        </form>
        <p className="auth-link"><Link to="/forgot-password" className="forgot-link">{t('loginForgot')}</Link></p>
        <p className="auth-link">{t('loginNoAccount')} <Link to="/register">{t('loginRegister')}</Link></p>
      </div>
    </div>
  );
}

export default Login;

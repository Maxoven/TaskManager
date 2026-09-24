import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { checkResetToken, resetPassword } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { Logo } from './AppHeader';
import './Auth.css';

function ResetPassword() {
  const { t, lang, toggleLang } = useLanguage();
  const { token } = useParams();
  const navigate = useNavigate();
  const [valid, setValid] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    checkResetToken(token).then(() => setValid(true)).catch(() => setValid(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError(t('resetMismatch')); return; }
    if (password.length < 8) { setError(t('resetShort')); return; }
    setError(''); setLoading(true);
    try { await resetPassword(token, password); setDone(true); setTimeout(() => navigate('/login'), 3000); }
    catch (err) { setError(err.response?.data?.error || t('resetError')); }
    finally { setLoading(false); }
  };

  const LangBtn = () => <div className="auth-lang-toggle"><Logo size={28} /><button onClick={toggleLang} className="lang-btn">{lang === 'ru' ? 'EN' : 'RU'}</button></div>;

  if (valid === null) return <div className="auth-container"><div className="auth-box"><LangBtn /><p>{t('resetChecking')}</p></div></div>;
  if (!valid) return (
    <div className="auth-container"><div className="auth-box">
      <LangBtn />
      <div style={{ fontSize: '48px', textAlign: 'center' }}>❌</div>
      <h2>{t('resetInvalidTitle')}</h2>
      <p>{t('resetInvalidText')}</p>
      <Link to="/forgot-password" className="btn-primary" style={{ display: 'block', textAlign: 'center', marginTop: '16px' }}>{t('resetInvalidBtn')}</Link>
    </div></div>
  );
  if (done) return (
    <div className="auth-container"><div className="auth-box">
      <LangBtn />
      <div className="success-icon">✅</div>
      <h2>{t('resetDoneTitle')}</h2>
      <p>{t('resetDoneText')}</p>
    </div></div>
  );

  return (
    <div className="auth-container">
      <div className="auth-box">
        <LangBtn />
        <h1>{t('resetTitle')}</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('resetNewPassword')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder={t('resetNewPasswordPlaceholder')} minLength={8} />
          </div>
          <div className="form-group">
            <label>{t('resetConfirm')}</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder={t('resetConfirmPlaceholder')} />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? t('resetLoading') : t('resetBtn')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ResetPassword;

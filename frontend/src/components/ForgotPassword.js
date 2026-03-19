import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import './Auth.css';

function ForgotPassword() {
  const { t, lang, toggleLang } = useLanguage();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await forgotPassword(email); setSent(true); }
    catch (err) { setError(err.response?.data?.error || t('forgotError')); }
    finally { setLoading(false); }
  };

  if (sent) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div className="auth-lang-toggle"><button onClick={toggleLang} className="lang-btn">{lang === 'ru' ? 'EN' : 'RU'}</button></div>
          <div className="success-icon">✅</div>
          <h2>{t('forgotSentTitle')}</h2>
          <p>{t('forgotSentText')}</p>
          <p style={{ color: '#888', fontSize: '14px' }}>{t('forgotSentHint')}</p>
          <Link to="/login" className="btn-primary" style={{ display: 'block', textAlign: 'center', marginTop: '16px' }}>{t('forgotBackBtn')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-lang-toggle"><button onClick={toggleLang} className="lang-btn">{lang === 'ru' ? 'EN' : 'RU'}</button></div>
        <h1>{t('forgotTitle')}</h1>
        <p style={{ color: '#666', marginBottom: '20px' }}>{t('forgotHint')}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('loginEmail')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? t('forgotLoading') : t('forgotBtn')}
          </button>
        </form>
        <p className="auth-link"><Link to="/login">{t('forgotBackToLogin')}</Link></p>
      </div>
    </div>
  );
}

export default ForgotPassword;

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import AuthLayout, { AuthStatus } from './AuthLayout';
import apiError from '../utils/apiError';
import Icon from './Icon';

function ForgotPassword() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await forgotPassword(email); setSent(true); }
    catch (err) { setError(apiError(err, t, 'forgotError')); }
    finally { setLoading(false); }
  };

  if (sent) {
    return (
      <AuthLayout>
        <AuthStatus kind="mail" title={t('forgotSentTitle')}>
          <p className="auth-status-text">{t('forgotSentText')}</p>
          <p className="auth-status-hint">{t('forgotSentHint')}</p>
          <Link to="/login" className="btn-primary auth-status-action">{t('forgotBackBtn')}</Link>
        </AuthStatus>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>{t('forgotTitle')}</h1>
      <p className="auth-intro">{t('forgotHint')}</p>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="forgot-email">{t('loginEmail')}</label>
          <input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@example.com" autoComplete="email" autoFocus />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? t('forgotLoading') : t('forgotBtn')}
        </button>
      </form>
      <p className="auth-link"><Link to="/login"><Icon name="arrow-left" />{t('forgotBackToLogin')}</Link></p>
    </AuthLayout>
  );
}

export default ForgotPassword;

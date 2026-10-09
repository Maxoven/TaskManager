import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { checkResetToken, resetPassword } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import AuthLayout, { AuthStatus, PasswordField } from './AuthLayout';
import apiError from '../utils/apiError';

function ResetPassword() {
  const { t } = useLanguage();
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

  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => navigate('/login'), 3000);
    return () => clearTimeout(timer);
  }, [done, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) { setError(t('resetShort')); return; }
    if (password !== confirm) { setError(t('resetMismatch')); return; }
    setError(''); setLoading(true);
    try { await resetPassword(token, password); setDone(true); }
    catch (err) { setError(apiError(err, t, 'resetError')); }
    finally { setLoading(false); }
  };

  if (valid === null) {
    return <AuthLayout><AuthStatus kind="loading" title={t('resetChecking')} /></AuthLayout>;
  }
  if (!valid) {
    return (
      <AuthLayout>
        <AuthStatus kind="error" title={t('resetInvalidTitle')}>
          <p className="auth-status-text">{t('resetInvalidText')}</p>
          <Link to="/forgot-password" className="btn-primary auth-status-action">{t('resetInvalidBtn')}</Link>
        </AuthStatus>
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout>
        <AuthStatus kind="success" title={t('resetDoneTitle')}>
          <p className="auth-status-text">{t('resetDoneText')}</p>
          <Link to="/login" className="btn-primary auth-status-action">{t('resetDoneBtn')}</Link>
        </AuthStatus>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>{t('resetTitle')}</h1>
      <form onSubmit={handleSubmit}>
        <PasswordField label={t('resetNewPassword')} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="new-password" hint={t('resetNewPasswordPlaceholder')} />
        <PasswordField label={t('resetConfirm')} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? t('resetLoading') : t('resetBtn')}
        </button>
      </form>
    </AuthLayout>
  );
}

export default ResetPassword;

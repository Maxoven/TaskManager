import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { login, resendVerification } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import AuthLayout, { PasswordField } from './AuthLayout';
import apiError from '../utils/apiError';

function Login({ onLogin }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resend, setResend] = useState({ state: 'idle', text: '' }); // idle | sending | done | error

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setNeedsVerification(false); setResend({ state: 'idle', text: '' }); setLoading(true);
    try {
      const response = await login({ email, password });
      onLogin(response.data.user, response.data.token);
    } catch (err) {
      if (err.response?.data?.needsVerification) setNeedsVerification(true);
      setError(apiError(err, t, 'loginError'));
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    setResend({ state: 'sending', text: '' });
    try {
      await resendVerification(email);
      setResend({ state: 'done', text: t('loginResendDone') });
    } catch (err) {
      setResend({ state: 'error', text: apiError(err, t, 'registerResendError') });
    }
  };

  return (
    <AuthLayout>
      <h1>{t('loginTitle')}</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="login-email">{t('loginEmail')}</label>
          <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@example.com" autoComplete="email" autoFocus />
        </div>
        <PasswordField label={t('loginPassword')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <div className="error" role="alert">{error}</div>}
        {needsVerification && (
          <div className="auth-notice">
            <p className="auth-notice-text">{t('loginNotReceived')}</p>
            <button type="button" onClick={handleResend} className="btn-secondary" disabled={resend.state === 'sending' || resend.state === 'done'}>
              {resend.state === 'sending' ? t('registerResendLoading') : t('registerResend')}
            </button>
            {resend.text && (
              <p className={resend.state === 'error' ? 'field-error' : 'auth-notice-success'} role="status">{resend.text}</p>
            )}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? t('loginLoading') : t('loginBtn')}
        </button>
      </form>
      <p className="auth-link"><Link to="/forgot-password" className="forgot-link">{t('loginForgot')}</Link></p>
      <p className="auth-link">{t('loginNoAccount')} <Link to="/register">{t('loginRegister')}</Link></p>
    </AuthLayout>
  );
}

export default Login;

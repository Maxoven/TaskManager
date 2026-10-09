import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { register, resendVerification } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import AuthLayout, { AuthStatus, PasswordField } from './AuthLayout';
import apiError from '../utils/apiError';
import Icon from './Icon';

function Register() {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [resend, setResend] = useState({ state: 'idle', text: '' }); // idle | sending | done | error

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (formData.password.length < 8) { setError(t('registerPasswordShort')); return; }
    if (formData.password !== formData.confirmPassword) { setError(t('registerPasswordMismatch')); return; }
    setLoading(true);
    try {
      await register({ name: formData.name, email: formData.email, password: formData.password });
      setRegistered(true);
    } catch (err) {
      setError(apiError(err, t, 'registerError'));
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    setResend({ state: 'sending', text: '' });
    try {
      await resendVerification(formData.email);
      setResend({ state: 'done', text: t('registerResendDone') });
    } catch (err) {
      setResend({ state: 'error', text: apiError(err, t, 'registerResendError') });
    }
  };

  if (registered) {
    return (
      <AuthLayout>
        <AuthStatus kind="mail" title={t('registerCheckEmail')}>
          <p className="auth-status-text">{t('registerEmailSent')} <strong>{formData.email}</strong></p>
          <p className="auth-status-hint">{t('registerEmailHint')}</p>
          <p className="auth-status-hint">{t('registerSpamHint')}</p>
          <button type="button" onClick={handleResend} disabled={resend.state === 'sending'} className="btn-secondary">
            {resend.state === 'sending' ? t('registerResendLoading') : t('registerResend')}
          </button>
          {resend.text && (
            <p className={resend.state === 'error' ? 'field-error' : 'auth-notice-success'} role="status">{resend.text}</p>
          )}
          <p className="auth-link"><Link to="/login"><Icon name="arrow-left" />{t('registerBackToLogin')}</Link></p>
        </AuthStatus>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>{t('registerTitle')}</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="register-name">{t('registerName')}</label>
          <input id="register-name" type="text" name="name" value={formData.name} onChange={handleChange} required placeholder={t('registerNamePlaceholder')} autoComplete="name" autoFocus aria-describedby="register-name-hint" />
          <p id="register-name-hint" className="field-hint">{t('registerNameHint')}</p>
        </div>
        <div className="form-group">
          <label htmlFor="register-email">{t('loginEmail')}</label>
          <input id="register-email" type="email" name="email" value={formData.email} onChange={handleChange} required placeholder="name@example.com" autoComplete="email" aria-describedby="register-email-hint" />
          <p id="register-email-hint" className="field-hint">{t('registerEmailFieldHint')}</p>
        </div>
        <PasswordField label={t('loginPassword')} name="password" value={formData.password} onChange={handleChange} minLength={8} autoComplete="new-password" hint={t('registerPasswordPlaceholder')} />
        <PasswordField label={t('registerConfirmPassword')} name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} autoComplete="new-password" />
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? t('registerLoading') : t('registerBtn')}
        </button>
      </form>
      <p className="auth-link">{t('registerHaveAccount')} <Link to="/login">{t('registerLoginLink')}</Link></p>
    </AuthLayout>
  );
}

export default Register;

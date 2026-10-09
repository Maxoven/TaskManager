import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { verifyEmail } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import AuthLayout, { AuthStatus } from './AuthLayout';
import apiError from '../utils/apiError';

function VerifyEmail({ onLogin }) {
  const { t } = useLanguage();
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');

  // Ссылка одноразовая: повторный запрос (StrictMode в dev) получил бы «ссылка недействительна»
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    const verify = async () => {
      try {
        const response = await verifyEmail(token);
        setStatus('success');
        if (response.data.user && response.data.token) {
          setTimeout(() => { onLogin(response.data.user, response.data.token); navigate('/'); }, 2000);
        }
      } catch (err) {
        setStatus('error');
        setMessage(apiError(err, t, 'verifyErrorTitle'));
      }
    };
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AuthLayout>
      {status === 'loading' && <AuthStatus kind="loading" title={t('verifyLoading')} />}
      {status === 'success' && (
        <AuthStatus kind="success" title={t('verifySuccess')}>
          <p className="auth-status-text">{t('verifySuccessText')}</p>
        </AuthStatus>
      )}
      {status === 'error' && (
        <AuthStatus kind="error" title={t('verifyErrorTitle')}>
          <p className="auth-status-text">{message}</p>
          <p className="auth-status-hint">{t('verifyErrorHint')}</p>
          <Link to="/login" className="btn-primary auth-status-action">{t('verifyGoToLogin')}</Link>
        </AuthStatus>
      )}
    </AuthLayout>
  );
}

export default VerifyEmail;

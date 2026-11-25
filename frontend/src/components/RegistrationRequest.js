import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getRegistrationRequest, approveRegistrationRequest, rejectRegistrationRequest } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { formatDate } from '../utils/date';
import AuthLayout, { AuthStatus } from './AuthLayout';
import apiError from '../utils/apiError';

// Страница по ссылке из письма «Заявка на регистрацию»: тот, кто одобряет, решает, создавать ли аккаунт.
// Открытие страницы ничего не меняет — решение только по кнопке.
function RegistrationRequest() {
  const { t, lang } = useLanguage();
  const { token } = useParams();
  const [request, setRequest] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | saving | error
  const [error, setError] = useState('');

  useEffect(() => {
    getRegistrationRequest(token)
      .then(({ data }) => { setRequest(data); setState('ready'); })
      .catch(err => { setError(apiError(err, t, 'regRequestErrorTitle')); setState('error'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const decide = async (approve) => {
    setState('saving'); setError('');
    try {
      const { data } = await (approve ? approveRegistrationRequest(token) : rejectRegistrationRequest(token));
      setRequest(data);
      setState('ready');
    } catch (err) {
      const fresh = err.response?.data?.request;
      if (fresh) setRequest(fresh);
      setError(apiError(err, t, 'regRequestActionError'));
      setState('ready');
    }
  };

  if (state === 'loading') {
    return <AuthLayout><AuthStatus kind="loading" title={t('regRequestLoading')} /></AuthLayout>;
  }
  if (state === 'error') {
    return (
      <AuthLayout>
        <AuthStatus kind="error" title={t('regRequestErrorTitle')}>
          <p className="auth-status-text">{error}</p>
          <Link to="/" className="btn-primary auth-status-action">{t('verifyGoToLogin')}</Link>
        </AuthStatus>
      </AuthLayout>
    );
  }

  const who = <><strong>{request.name}</strong> ({request.email})</>;
  if (request.status !== 'pending') {
    const approved = request.status === 'approved';
    return (
      <AuthLayout>
        <AuthStatus kind={approved ? 'success' : 'error'} title={t(approved ? 'regRequestApprovedTitle' : 'regRequestRejectedTitle')}>
          <p className="auth-status-text">{who}</p>
          <p className="auth-status-hint">{t(approved ? 'regRequestApprovedText' : 'regRequestRejectedText', { name: request.name })}</p>
          {error && <p className="field-error" role="alert">{error}</p>}
        </AuthStatus>
      </AuthLayout>
    );
  }

  const saving = state === 'saving';
  return (
    <AuthLayout>
      <AuthStatus kind="mail" title={t('regRequestTitle')}>
        <p className="auth-status-text">{who} {t('regRequestText')}</p>
        <p className="auth-status-hint">{t('regRequestDate', { date: formatDate(request.created_at, lang) })}</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="auth-status-buttons">
          <button type="button" className="btn-secondary" onClick={() => decide(false)} disabled={saving}>{t('regRequestReject')}</button>
          <button type="button" className="btn-primary" onClick={() => decide(true)} disabled={saving}>
            {saving && <span className="spinner" aria-hidden="true" />}{t('regRequestApprove')}
          </button>
        </div>
      </AuthStatus>
    </AuthLayout>
  );
}

export default RegistrationRequest;

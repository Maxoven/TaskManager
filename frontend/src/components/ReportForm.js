import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getReportByToken, submitReportByToken } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import AuthLayout, { AuthStatus } from './AuthLayout';
import apiError from '../utils/apiError';

function ReportForm() {
  const { t } = useLanguage();
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [reportText, setReportText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getReportByToken(token)
      .then(res => setInfo(res.data))
      .catch(err => setLoadError(apiError(err, t, 'reportLinkInvalid')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reportText.trim()) return;
    setSubmitError(''); setSubmitting(true);
    // Ошибку отправки показываем под полем — набранный текст не теряется
    try { await submitReportByToken(token, reportText); setDone(true); }
    catch (err) { setSubmitError(apiError(err, t, 'reportError')); }
    finally { setSubmitting(false); }
  };

  if (loading) return <AuthLayout><AuthStatus kind="loading" title={t('loading')} /></AuthLayout>;

  if (loadError) {
    return (
      <AuthLayout>
        <AuthStatus kind="error" title={t('reportErrorTitle')}>
          <p className="auth-status-text">{loadError}</p>
          <p className="auth-status-hint">{t('reportLinkInvalidHint')}</p>
        </AuthStatus>
      </AuthLayout>
    );
  }

  if (info?.alreadySubmitted || done) {
    return (
      <AuthLayout>
        <AuthStatus kind="success" title={done ? t('reportSentTitle') : t('reportAlreadySentTitle')}>
          <p className="auth-status-text">{t('reportSentText')}, {info?.userName}! {t('reportYourReport')} <strong>«{info?.taskTitle}»</strong> {t('reportSentTask')}</p>
          <p className="auth-status-hint">{t('reportSentHint')}</p>
        </AuthStatus>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout className="report-box">
      <h1>{t('reportTitle')}</h1>
      <p className="auth-intro">{t('reportIntro', { name: info?.userName || '' })}</p>
      <dl className="report-task-info">
        <dt className="report-label">{t('reportProject')}</dt>
        <dd className="report-value">{info?.projectName}</dd>
        <dt className="report-label">{t('reportTask')}</dt>
        <dd className="report-value">{info?.taskTitle}</dd>
      </dl>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="report-text">{t('reportLabel')}</label>
          <textarea id="report-text" value={reportText} onChange={(e) => setReportText(e.target.value)} required placeholder={t('reportPlaceholder')} rows="8" aria-describedby="report-text-hint" autoFocus />
          <p id="report-text-hint" className="field-hint">{t('reportHint')}</p>
        </div>
        {submitError && <div className="error" role="alert">{submitError}</div>}
        <button type="submit" disabled={submitting || !reportText.trim()} className="btn-primary">
          {submitting ? t('reportSending') : t('reportBtn')}
        </button>
      </form>
    </AuthLayout>
  );
}

export default ReportForm;

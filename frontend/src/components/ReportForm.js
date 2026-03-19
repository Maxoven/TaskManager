import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getReportByToken, submitReportByToken } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import './Auth.css';

function ReportForm() {
  const { t, lang, toggleLang } = useLanguage();
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [reportText, setReportText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getReportByToken(token)
      .then(res => setInfo(res.data))
      .catch(err => setError(err.response?.data?.error || t('reportLinkInvalid')))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reportText.trim()) return;
    setSubmitting(true);
    try { await submitReportByToken(token, reportText); setDone(true); }
    catch (err) { setError(err.response?.data?.error || t('reportError')); }
    finally { setSubmitting(false); }
  };

  const LangBtn = () => <div className="auth-lang-toggle"><button onClick={toggleLang} className="lang-btn">{lang === 'ru' ? 'EN' : 'RU'}</button></div>;

  if (loading) return <div className="auth-container"><div className="auth-box"><LangBtn /><p>{t('loading')}</p></div></div>;
  if (error) return <div className="auth-container"><div className="auth-box"><LangBtn /><div style={{ fontSize: '48px', textAlign: 'center' }}>❌</div><h2>{t('reportErrorTitle')}</h2><p>{error}</p></div></div>;

  if (info?.alreadySubmitted || done) {
    return (
      <div className="auth-container"><div className="auth-box"><LangBtn />
        <div className="success-icon">✅</div>
        <h2>{done ? t('reportSentTitle') : t('reportAlreadySentTitle')}</h2>
        <p>{t('reportSentText')}, {info?.userName}! {lang === 'ru' ? 'Ваш отчёт по задаче' : 'Your report for task'} <strong>«{info?.taskTitle}»</strong> {t('reportSentTask')}</p>
      </div></div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box report-box">
        <LangBtn />
        <h1>{t('reportTitle')}</h1>
        <div className="report-task-info">
          <p className="report-label">{t('reportProject')}</p>
          <p className="report-value">{info?.projectName}</p>
          <p className="report-label">{t('reportTask')}</p>
          <p className="report-value">{info?.taskTitle}</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('reportLabel')}</label>
            <textarea value={reportText} onChange={(e) => setReportText(e.target.value)} required placeholder={t('reportPlaceholder')} rows="8" style={{ resize: 'vertical' }} />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={submitting || !reportText.trim()} className="btn-primary">
            {submitting ? t('reportSending') : t('reportBtn')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ReportForm;

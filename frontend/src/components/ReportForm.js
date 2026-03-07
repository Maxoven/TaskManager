import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getReportByToken, submitReportByToken } from '../services/api';
import './Auth.css';

function ReportForm() {
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
      .catch(err => setError(err.response?.data?.error || 'Ссылка недействительна или истекла'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reportText.trim()) return;
    setSubmitting(true);
    try {
      await submitReportByToken(token, reportText);
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка отправки отчёта');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="auth-container"><div className="auth-box"><p>Загрузка...</p></div></div>;
  }

  if (error) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div style={{ fontSize: '48px', textAlign: 'center' }}>❌</div>
          <h2>Ошибка</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (info?.alreadySubmitted || done) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div className="success-icon">✅</div>
          <h2>{done ? 'Отчёт отправлен!' : 'Отчёт уже отправлен'}</h2>
          <p>Спасибо, {info?.userName}! Ваш отчёт по задаче <strong>«{info?.taskTitle}»</strong> был получен.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box report-box">
        <h1>Отчёт по задаче</h1>
        <div className="report-task-info">
          <p className="report-label">Проект</p>
          <p className="report-value">{info?.projectName}</p>
          <p className="report-label">Задача</p>
          <p className="report-value">{info?.taskTitle}</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Ваш отчёт</label>
            <textarea
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              required
              placeholder="Опишите что было сделано по данной задаче..."
              rows="8"
              style={{ resize: 'vertical' }}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={submitting || !reportText.trim()} className="btn-primary">
            {submitting ? 'Отправка...' : 'Отправить отчёт'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ReportForm;

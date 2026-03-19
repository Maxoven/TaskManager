import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { verifyEmail } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import './Auth.css';

function VerifyEmail({ onLogin }) {
  const { t, lang, toggleLang } = useLanguage();
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const verify = async () => {
      try {
        const response = await verifyEmail(token);
        setStatus('success');
        if (response.data.user && response.data.token) {
          setTimeout(() => { onLogin(response.data.user, response.data.token); navigate('/'); }, 2000);
        }
      } catch (err) {
        setStatus('error');
        setMessage(err.response?.data?.error || t('verifyErrorTitle'));
      }
    };
    verify();
  }, [token]);

  return (
    <div className="auth-container">
      <div className="auth-box" style={{ textAlign: 'center' }}>
        <div className="auth-lang-toggle"><button onClick={toggleLang} className="lang-btn">{lang === 'ru' ? 'EN' : 'RU'}</button></div>
        {status === 'loading' && (<><div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div><h2>{t('verifyLoading')}</h2></>)}
        {status === 'success' && (<><div style={{ fontSize: 48, marginBottom: 16 }}>✅</div><h2>{t('verifySuccess')}</h2><p style={{ color: '#555' }}>{t('verifySuccessText')}</p></>)}
        {status === 'error' && (<><div style={{ fontSize: 48, marginBottom: 16 }}>❌</div><h2>{t('verifyErrorTitle')}</h2><p style={{ color: '#888' }}>{message}</p><p style={{ marginTop: 16, fontSize: 13 }}><Link to="/login">{t('verifyBackToLogin')}</Link></p></>)}
      </div>
    </div>
  );
}

export default VerifyEmail;

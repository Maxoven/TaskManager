import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { verifyEmail } from '../services/api';
import './Auth.css';

function VerifyEmail({ onLogin }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const verify = async () => {
      try {
        const response = await verifyEmail(token);
        setStatus('success');
        // Автоматически логиним пользователя
        if (response.data.user && response.data.token) {
          setTimeout(() => {
            onLogin(response.data.user, response.data.token);
            navigate('/');
          }, 2000);
        }
      } catch (err) {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Ссылка недействительна или истекла');
      }
    };
    verify();
  }, [token]);

  return (
    <div className="auth-container">
      <div className="auth-box" style={{ textAlign: 'center' }}>
        {status === 'loading' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
            <h2>Подтверждаем email...</h2>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2>Email подтверждён!</h2>
            <p style={{ color: '#555' }}>Выполняем вход в систему...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <h2>Ошибка подтверждения</h2>
            <p style={{ color: '#888' }}>{message}</p>
            <p style={{ marginTop: 16, fontSize: 13 }}>
              <Link to="/login">← Вернуться ко входу</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default VerifyEmail;

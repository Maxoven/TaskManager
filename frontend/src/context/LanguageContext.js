import React, { createContext, useContext, useEffect, useState } from 'react';
import translations from '../i18n';
import { saveLanguage } from '../services/api';

const LanguageContext = createContext();
const SUPPORTED = ['ru', 'en'];

// Приоритет: ?lang= из ссылки в письме → сохранённый выбор → язык браузера
function detectLang() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (SUPPORTED.includes(fromUrl)) return fromUrl;
    const saved = localStorage.getItem('lang');
    if (SUPPORTED.includes(saved)) return saved;
  } catch (e) { /* localStorage недоступен */ }
  return (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(detectLang);

  useEffect(() => {
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const toggleLang = () => {
    const next = lang === 'ru' ? 'en' : 'ru';
    setLang(next);
    // Письма приходят на языке, сохранённом на сервере
    if (localStorage.getItem('token')) {
      saveLanguage(next).catch(() => {});
    }
  };

  // t('key') или t('key', { name: 'X' }) — подставляет {name} в строку
  const t = (key, vars) => {
    const text = translations[lang]?.[key] ?? translations.ru[key] ?? key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? vars[name] : m));
  };

  return (
    <LanguageContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LangToggle({ className = '' }) {
  const { lang, toggleLang } = useLanguage();
  return (
    <button type="button" onClick={toggleLang} className={`lang-btn ${className}`} title={lang === 'ru' ? 'Switch to English' : 'Переключить на русский'}>
      {lang === 'ru' ? 'EN' : 'RU'}
    </button>
  );
}

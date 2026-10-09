// Текст ошибки для пользователя: ответ сервера → «нет связи» → запасной текст
export default function apiError(error, t, fallbackKey = 'genericError') {
  const fromServer = error?.response?.data?.error;
  if (typeof fromServer === 'string' && fromServer) return fromServer;
  if (error && !error.response) return t('networkError');
  return t(fallbackKey);
}

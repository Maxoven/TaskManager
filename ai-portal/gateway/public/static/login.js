const form = document.getElementById('form');
const error = document.getElementById('error');
const submit = document.getElementById('submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  submit.disabled = true;
  submit.innerHTML = '<span class="spinner" aria-hidden="true"></span> Входим…';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value, password: form.password.value })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Не удалось войти');
    location.href = '/';
  } catch (err) {
    error.textContent = err.message === 'Failed to fetch' ? 'Нет связи с сервером' : err.message;
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Войти';
  }
});

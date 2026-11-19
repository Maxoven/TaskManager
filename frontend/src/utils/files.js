// Общие правила для файлов задач и проектов (те же, что проверяет сервер — services/uploads.js)
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip', 'rar'];
export const ACCEPT_ATTR = ALLOWED_EXT.map(ext => `.${ext}`).join(',');

export const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// Делит выбранные файлы на подходящие и сообщения о неподходящих (формат, размер)
export function splitValidFiles(fileList, t) {
  const valid = [];
  const problems = [];
  Array.from(fileList).forEach(file => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) problems.push(t('taskFileTypeError', { name: file.name }));
    else if (file.size > MAX_FILE_SIZE) problems.push(t('taskFileSizeErrorNamed', { name: file.name }));
    else valid.push(file);
  });
  return { valid, problems };
}

// Скачать файл, полученный через API как blob
export function saveBlob(data, fileName) {
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

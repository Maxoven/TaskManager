// Загрузка файлов к задачам и проектам — одни правила для всех.
// Файлы лежат вне папки, которую раздаёт nginx (/uploads/), — скачать их можно только
// через API с проверкой доступа к проекту.
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../storage/uploads');

const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.zip', '.rar'
]);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    fs.mkdir(UPLOADS_DIR, { recursive: true }, (err) => cb(err, UPLOADS_DIR));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    // multer отдаёт имя файла в latin1 — без перекодировки кириллица превращается в «Ð¾Ñ‚Ñ‡Ñ‘Ñ‚»
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // Проверяем именно расширение: MIME-тип присылает клиент, ему доверять нельзя
    if (ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase())) {
      return cb(null, true);
    }
    const err = new Error('Unsupported file format');
    err.code = 'UNSUPPORTED_FILE';
    cb(err);
  }
});

const uploadedPath = (filename) => path.join(UPLOADS_DIR, filename);

// Удаление файла с диска — в фоне и без падения, если файла уже нет
function removeUploadedFile(filename) {
  fs.unlink(uploadedPath(filename), (err) => {
    if (err && err.code !== 'ENOENT') console.error('Не удалось удалить файл:', err.message);
  });
}

// Если запись в базу не удалась — файл, уже сохранённый multer'ом, не должен остаться на диске
function discardUpload(file) {
  if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
}

module.exports = { UPLOADS_DIR, upload, uploadedPath, removeUploadedFile, discardUpload };

// Размер интерфейса: масштаб корневого шрифта. Текст, отступы и высота
// элементов управления заданы в rem (см. index.css), поэтому растут вместе.
// Выбор хранится в браузере — у каждого устройства свой.
export const INTERFACE_SIZES = [
  { id: 'small', scale: 0.9 },
  { id: 'default', scale: 1 },
  { id: 'large', scale: 1.1 },
  { id: 'xlarge', scale: 1.2 }
];

const STORAGE_KEY = 'interfaceSize';

export function getInterfaceSize() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (INTERFACE_SIZES.some(s => s.id === saved)) return saved;
  } catch (e) { /* localStorage недоступен */ }
  return 'default';
}

export function applyInterfaceSize(id) {
  const size = INTERFACE_SIZES.find(s => s.id === id) || INTERFACE_SIZES[1];
  // Проценты, а не px: сохраняется размер шрифта, выбранный в настройках браузера
  document.documentElement.style.fontSize = size.scale === 1 ? '' : `${size.scale * 100}%`;
}

export function setInterfaceSize(id) {
  applyInterfaceSize(id);
  try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* localStorage недоступен */ }
}

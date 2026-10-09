import React from 'react';

// Единый набор значков: контурные inline-SVG на сетке 24×24, цвет — currentColor.
// Значки декоративные (aria-hidden): смысл всегда несёт текст рядом,
// aria-label кнопки или скрытая подпись .visually-hidden.
const dot = (cx, cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.4" fill="currentColor" stroke="none" />;

const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  alert: <><path d="M12 4l9 15.5H3z" /><path d="M12 10v4M12 16.8v.2" /></>,
  'alert-circle': <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.2v.2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.2" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.4 9.6a2.6 2.6 0 1 1 3.9 2.2c-.8.5-1.3 1-1.3 2M12 16.8v.2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2.2 2.3h7.2a2 2 0 0 1 2 2v7.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3M15.8 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.6c2.1.6 3.5 2.4 3.5 4.9" /></>,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  paperclip: <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7-7l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />,
  file: <><path d="M6.5 3.5h7L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M13.5 3.5V8H18" /></>,
  'file-check': <><path d="M6.5 3.5h7L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M13.5 3.5V8H18M8.8 14.3l2 2 4-4.4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7.5l8.5 6 8.5-6" /></>,
  grip: <>{[6, 12, 18].flatMap(cy => [dot(9, cy), dot(15, cy)])}</>,
  pencil: <><path d="M4 20l1-4.2L15.8 5a2.1 2.1 0 0 1 3 3L8 18.9z" /><path d="M14 7l3 3" /></>,
  trash: <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v5.5M14 11v5.5" />,
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /><path d="M4 4l16 16" /></>,
  board: <><rect x="3.5" y="4" width="4.6" height="16" rx="1.4" /><rect x="9.7" y="4" width="4.6" height="10" rx="1.4" /><rect x="15.9" y="4" width="4.6" height="13" rx="1.4" /></>,
  timeline: <><rect x="3.5" y="4.5" width="9" height="3.6" rx="1.4" /><rect x="8" y="10.2" width="12.5" height="3.6" rx="1.4" /><rect x="5.5" y="15.9" width="8" height="3.6" rx="1.4" /></>,
  logout: <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M15 8l4 4-4 4M19 12H9.5" />,
  reorder: <path d="M7 4.5v15M3.5 8L7 4.5 10.5 8M17 19.5v-15M13.5 16l3.5 3.5 3.5-3.5" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  sparkles: <><path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z" /><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" /><path d="M4 4v4.6h4.6M12 8v4.2l2.8 1.8" /></>,
  send: <path d="M4.5 12L20 4.5l-5 15.5-3.2-6.3zM11.8 13.7L20 4.5" />,
  star: <path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />
};

function Icon({ name, size = 16, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

export default Icon;

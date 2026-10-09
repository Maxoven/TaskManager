import React from 'react';

// Кружок с первой буквой имени. Оттенок выбирается по имени, поэтому один и тот же
// человек везде одного цвета. muted — для тех, кто ещё не принял приглашение.
const HUES = 6;

function hueOf(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 9973;
  return hash % HUES;
}

function Avatar({ name = '', size = 'md', muted = false, className = '', ...rest }) {
  const clean = String(name || '').trim();
  const tone = muted ? 'avatar-muted' : `avatar-h${hueOf(clean)}`;
  return (
    <span className={`avatar avatar-${size} ${tone} ${className}`} {...rest}>
      {(clean.charAt(0) || '?').toUpperCase()}
    </span>
  );
}

export default Avatar;

import React, { useState } from 'react';
import { avatarUrl } from '../services/api';
import { teamMark } from '../context/TeamContext';

// Кружок с фото профиля, а без фото — с первой буквой имени. Оттенок выбирается по имени,
// поэтому один и тот же человек везде одного цвета. muted — для тех, кто ещё не принял приглашение.
// square — квадрат со скруглением (знак команды, а не человека).
const HUES = 6;

function hueOf(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 9973;
  return hash % HUES;
}

function Avatar({ name = '', src = null, size = 'md', muted = false, square = false, className = '', ...rest }) {
  // У знака команды буква — по смыслу названия, без слова «Команда»
  const clean = String((square ? teamMark(name) : name) || '').trim();
  const [failed, setFailed] = useState(null);
  const tone = muted ? 'avatar-muted' : `avatar-h${hueOf(clean)}`;
  const url = src && failed !== src ? avatarUrl(src) : null;
  return (
    <span className={`avatar avatar-${size} ${tone} ${square ? 'avatar-square' : ''} ${url ? 'avatar-photo' : ''} ${className}`} {...rest}>
      {url
        ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
        : (clean.charAt(0) || '?').toUpperCase()}
    </span>
  );
}

export default Avatar;

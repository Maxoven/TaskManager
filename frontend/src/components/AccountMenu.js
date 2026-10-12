import React, { useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useUser } from '../context/UserContext';
import { useFeedback } from '../context/FeedbackContext';
import { INTERFACE_SIZES, getInterfaceSize, setInterfaceSize } from '../utils/interfaceSize';
import { uploadAvatar, deleteAvatar } from '../services/api';
import cropAvatar from '../utils/cropAvatar';
import apiError from '../utils/apiError';
import usePopover from '../utils/usePopover';
import Avatar from './Avatar';
import Icon from './Icon';
import './AccountMenu.css';

const LANGUAGES = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' }
];

// Кнопка аккаунта в шапке: по нажатию — панель с фото профиля, языком и размером интерфейса
function AccountMenu({ user }) {
  const { lang, setLanguage, t } = useLanguage();
  const { updateUser } = useUser();
  const { notify, confirm } = useFeedback();
  const { open, setOpen, rootRef, buttonRef } = usePopover();
  const [size, setSize] = useState(getInterfaceSize);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileRef = useRef(null);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // тот же файл можно выбрать снова
    if (!file) return;
    setPhotoError('');
    setPhotoBusy(true);
    try {
      let blob;
      try {
        blob = await cropAvatar(file);
      } catch {
        setPhotoError(t('photoDecodeError'));
        return;
      }
      const { data } = await uploadAvatar(blob);
      updateUser({ avatar: data.avatar });
      notify.success(t('photoSavedToast'));
    } catch (err) {
      setPhotoError(apiError(err, t, 'photoSaveError'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemovePhoto = async () => {
    const ok = await confirm({
      title: t('photoRemoveTitle'),
      message: t('photoRemoveText'),
      confirmLabel: t('photoRemoveConfirm'),
      cancelLabel: t('cancel'),
      danger: true
    });
    if (!ok) return;
    setPhotoBusy(true);
    try {
      await deleteAvatar();
      updateUser({ avatar: null });
    } catch (err) {
      setPhotoError(apiError(err, t, 'photoSaveError'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const chooseSize = (id) => {
    setSize(id);
    setInterfaceSize(id);
  };

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`user-chip account-menu-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={open ? 'account-menu-panel' : undefined}
        aria-label={t('accountMenuLabel', { name: user.name })}
        title={user.email}
      >
        <Avatar name={user.name} src={user.avatar} size="sm" className="user-chip-avatar" aria-hidden="true" />
        <span className="user-chip-name">{user.name}</span>
        <Icon name="chevron-down" size={14} className="account-menu-chevron" />
      </button>

      {open && (
        <div className="account-menu-panel" id="account-menu-panel" role="group" aria-label={t('accountSettings')}>
          <div className="account-menu-user">
            <Avatar name={user.name} src={user.avatar} size="xl" className="account-menu-photo" aria-hidden="true" />
            <div className="account-menu-user-text">
              <span className="account-menu-name">{user.name}</span>
              <span className="account-menu-email">{user.email}</span>
              <div className="account-menu-photo-actions">
                <button type="button" className="btn-small" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                  <Icon name="camera" size={14} />
                  {photoBusy ? t('photoUploading') : user.avatar ? t('photoChange') : t('photoUpload')}
                </button>
                {user.avatar && (
                  <button type="button" className="account-menu-photo-remove" onClick={handleRemovePhoto} disabled={photoBusy}>
                    {t('photoRemove')}
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={handlePhoto} />
            </div>
          </div>
          <p className={`account-menu-photo-hint ${photoError ? 'is-error' : ''}`} role={photoError ? 'alert' : undefined}>
            {photoError || t('photoHint')}
          </p>

          <div className="account-menu-section">
            <span className="account-menu-label" id="account-lang-label">{t('settingsLanguage')}</span>
            <div className="segmented account-menu-segmented" role="group" aria-labelledby="account-lang-label">
              {LANGUAGES.map(l => (
                <button
                  key={l.id}
                  type="button"
                  lang={l.id}
                  className={`segmented-btn ${lang === l.id ? 'active' : ''}`}
                  aria-pressed={lang === l.id}
                  onClick={() => setLanguage(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="account-menu-section">
            <span className="account-menu-label" id="account-size-label">
              {t('settingsInterfaceSize')}
              <span className="account-menu-value">{t(`interfaceSize_${size}`)}</span>
            </span>
            <div className="segmented account-menu-segmented account-menu-sizes" role="group" aria-labelledby="account-size-label">
              {INTERFACE_SIZES.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={`segmented-btn account-size-btn account-size-${i} ${size === s.id ? 'active' : ''}`}
                  aria-pressed={size === s.id}
                  aria-label={t(`interfaceSize_${s.id}`)}
                  title={t(`interfaceSize_${s.id}`)}
                  onClick={() => chooseSize(s.id)}
                >
                  <span aria-hidden="true">A</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountMenu;

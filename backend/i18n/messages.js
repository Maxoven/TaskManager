// Тексты ответов API на двух языках.
// Язык запроса берётся из заголовка X-Lang / Accept-Language (см. middleware/lang.js).

const messages = {
  ru: {
    authRequired: 'Требуется авторизация',
    invalidToken: 'Недействительный токен',
    serverError: 'Внутренняя ошибка сервера',
    apiRunning: 'Task Manager API работает!',
    notFound: 'Не найдено',

    // Auth
    passwordTooShort: 'Пароль должен содержать минимум 8 символов',
    userExists: 'Пользователь уже существует',
    registerSuccess: 'Регистрация прошла успешно! Проверьте email для подтверждения аккаунта.',
    registerError: 'Ошибка регистрации',
    invalidCredentials: 'Неверный email или пароль',
    emailNotVerified: 'Email не подтверждён. Проверьте почту и перейдите по ссылке из письма.',
    loginError: 'Ошибка входа',
    linkInvalid: 'Ссылка недействительна или истекла',
    emailVerified: 'Email подтверждён!',
    verifyError: 'Ошибка подтверждения email',
    resendGeneric: 'Если аккаунт существует и не подтверждён — письмо отправлено',
    resendDone: 'Письмо отправлено повторно',
    emailSendError: 'Ошибка отправки письма',
    forgotGeneric: 'Если такой email зарегистрирован, мы отправили письмо',
    passwordChanged: 'Пароль успешно изменён',
    passwordChangeError: 'Ошибка изменения пароля',
    tokenCheckError: 'Ошибка проверки токена',
    languageSaved: 'Язык сохранён',
    languageInvalid: 'Неподдерживаемый язык',

    // Projects
    projectsFetchError: 'Ошибка получения проектов',
    projectCreateError: 'Ошибка создания проекта',
    onlyOwnerEdit: 'Только владелец может редактировать проект',
    projectUpdateError: 'Ошибка обновления проекта',
    projectIdsArray: 'projectIds должен быть массивом',
    orderSaved: 'Порядок обновлён',
    orderError: 'Ошибка изменения порядка',
    onlyOwnerDelete: 'Только владелец может удалить проект',
    projectDeleted: 'Проект удалён',
    projectDeleteError: 'Ошибка удаления проекта',
    accessDenied: 'Доступ запрещён',
    projectFetchError: 'Ошибка получения проекта',
    onlyOwnerRemoveMembers: 'Только владелец может удалять участников',
    memberRemovedFromProject: 'Участник удалён из проекта',
    memberRemoveError: 'Ошибка удаления участника',
    onlyOwnerInvite: 'Только владелец может приглашать',
    userNotFound: 'Пользователь не найден',
    userAlreadyInvited: 'Пользователь уже приглашён',
    cannotInviteSelf: 'Нельзя пригласить самого себя',
    invitationSent: 'Приглашение отправлено',
    invitationSendError: 'Ошибка отправки приглашения',
    invitationsFetchError: 'Ошибка получения приглашений',
    invalidAction: 'Неверное действие',
    invitationAccepted: 'Приглашение принято',
    invitationRejected: 'Приглашение отклонено',
    invitationProcessError: 'Ошибка обработки приглашения',
    defaultStatuses: ['Бэклог', 'В работе', 'Готово'],

    // Team
    teamFetchError: 'Ошибка получения команды',
    cannotAddSelf: 'Нельзя добавить себя в команду',
    userWithEmailNotFound: 'Пользователь с таким email не найден',
    teamInvitePending: 'Приглашение уже отправлено, ожидает подтверждения',
    alreadyInTeam: 'Этот пользователь уже в вашей команде',
    memberRemovedFromTeam: 'Участник удалён из команды',

    // Tasks
    tasksFetchError: 'Ошибка получения задач',
    taskCreateError: 'Ошибка создания задачи',
    taskUpdateError: 'Ошибка обновления задачи',
    taskDeleted: 'Задача удалена',
    taskDeleteError: 'Ошибка удаления задачи',
    taskNotFound: 'Задача не найдена',
    genericError: 'Ошибка',
    reportEmpty: 'Текст отчёта не может быть пустым',
    reportAlreadySent: 'Отчёт уже был отправлен',
    reportSent: 'Отчёт успешно отправлен',
    reportSendError: 'Ошибка отправки отчёта',
    reportsFetchError: 'Ошибка получения отчётов',
    fileNotUploaded: 'Файл не загружен',
    fileUploadError: 'Ошибка загрузки файла',
    fileUnsupported: 'Неподдерживаемый формат файла',
    fileTooLarge: 'Файл слишком большой. Максимальный размер: 10MB',
    filesFetchError: 'Ошибка получения файлов',
    fileNotFound: 'Файл не найден',
    fileMissingOnServer: 'Файл не найден на сервере',
    fileDownloadError: 'Ошибка скачивания файла',
    fileDeleted: 'Файл удалён',
    fileDeleteError: 'Ошибка удаления файла'
  },

  en: {
    authRequired: 'Authorization required',
    invalidToken: 'Invalid token',
    serverError: 'Internal server error',
    apiRunning: 'Task Manager API is running!',
    notFound: 'Not found',

    // Auth
    passwordTooShort: 'Password must be at least 8 characters',
    userExists: 'User already exists',
    registerSuccess: 'Registration successful! Check your email to confirm your account.',
    registerError: 'Registration error',
    invalidCredentials: 'Invalid email or password',
    emailNotVerified: 'Email is not verified. Check your inbox and follow the link in the email.',
    loginError: 'Login error',
    linkInvalid: 'The link is invalid or has expired',
    emailVerified: 'Email verified!',
    verifyError: 'Email verification error',
    resendGeneric: 'If the account exists and is not verified, an email has been sent',
    resendDone: 'Email sent again',
    emailSendError: 'Failed to send email',
    forgotGeneric: 'If this email is registered, we have sent you an email',
    passwordChanged: 'Password changed successfully',
    passwordChangeError: 'Error changing password',
    tokenCheckError: 'Error checking token',
    languageSaved: 'Language saved',
    languageInvalid: 'Unsupported language',

    // Projects
    projectsFetchError: 'Error loading projects',
    projectCreateError: 'Error creating project',
    onlyOwnerEdit: 'Only the owner can edit the project',
    projectUpdateError: 'Error updating project',
    projectIdsArray: 'projectIds must be an array',
    orderSaved: 'Order updated',
    orderError: 'Error changing order',
    onlyOwnerDelete: 'Only the owner can delete the project',
    projectDeleted: 'Project deleted',
    projectDeleteError: 'Error deleting project',
    accessDenied: 'Access denied',
    projectFetchError: 'Error loading project',
    onlyOwnerRemoveMembers: 'Only the owner can remove members',
    memberRemovedFromProject: 'Member removed from project',
    memberRemoveError: 'Error removing member',
    onlyOwnerInvite: 'Only the owner can invite',
    userNotFound: 'User not found',
    userAlreadyInvited: 'User has already been invited',
    cannotInviteSelf: 'You cannot invite yourself',
    invitationSent: 'Invitation sent',
    invitationSendError: 'Error sending invitation',
    invitationsFetchError: 'Error loading invitations',
    invalidAction: 'Invalid action',
    invitationAccepted: 'Invitation accepted',
    invitationRejected: 'Invitation declined',
    invitationProcessError: 'Error processing invitation',
    defaultStatuses: ['Backlog', 'In progress', 'Done'],

    // Team
    teamFetchError: 'Error loading team',
    cannotAddSelf: 'You cannot add yourself to the team',
    userWithEmailNotFound: 'No user with this email was found',
    teamInvitePending: 'Invitation already sent, awaiting confirmation',
    alreadyInTeam: 'This user is already in your team',
    memberRemovedFromTeam: 'Member removed from team',

    // Tasks
    tasksFetchError: 'Error loading tasks',
    taskCreateError: 'Error creating task',
    taskUpdateError: 'Error updating task',
    taskDeleted: 'Task deleted',
    taskDeleteError: 'Error deleting task',
    taskNotFound: 'Task not found',
    genericError: 'Error',
    reportEmpty: 'Report text cannot be empty',
    reportAlreadySent: 'The report has already been submitted',
    reportSent: 'Report submitted successfully',
    reportSendError: 'Error submitting report',
    reportsFetchError: 'Error loading reports',
    fileNotUploaded: 'No file uploaded',
    fileUploadError: 'Error uploading file',
    fileUnsupported: 'Unsupported file format',
    fileTooLarge: 'File too large. Maximum size: 10MB',
    filesFetchError: 'Error loading files',
    fileNotFound: 'File not found',
    fileMissingOnServer: 'File not found on the server',
    fileDownloadError: 'Error downloading file',
    fileDeleted: 'File deleted',
    fileDeleteError: 'Error deleting file'
  }
};

const SUPPORTED = ['ru', 'en'];
const DEFAULT_LANG = 'ru';

function normalizeLang(value) {
  if (!value) return DEFAULT_LANG;
  const code = String(value).trim().slice(0, 2).toLowerCase();
  return SUPPORTED.includes(code) ? code : DEFAULT_LANG;
}

function translate(lang, key) {
  const l = normalizeLang(lang);
  return messages[l][key] ?? messages[DEFAULT_LANG][key] ?? key;
}

module.exports = { messages, translate, normalizeLang, SUPPORTED, DEFAULT_LANG };

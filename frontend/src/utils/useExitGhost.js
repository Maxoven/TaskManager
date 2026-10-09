import { useLayoutEffect } from 'react';

const EXIT_MS = 220;

// Плавное закрытие окна. Окна убирает из дерева родитель (после сохранения, по «Отмена»,
// по Escape…), поэтому анимацию исчезновения доигрывает неинтерактивная копия узла:
// в момент размонтирования она встаёт на то же место с классом .is-leaving и удаляется
// по окончании анимации. На поведение, фокус и состояние окна это не влияет.
export default function useExitGhost(ref) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    return () => {
      if (typeof window === 'undefined' || !node.isConnected) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

      const ghost = node.cloneNode(true);
      // Введённые значения и прокрутка не копируются cloneNode — переносим вручную,
      // чтобы содержимое не «прыгало» во время исчезновения
      const fields = node.querySelectorAll('input, textarea, select');
      const ghostFields = ghost.querySelectorAll('input, textarea, select');
      fields.forEach((field, i) => {
        const copy = ghostFields[i];
        if (!copy) return;
        if (field.type === 'checkbox' || field.type === 'radio') copy.checked = field.checked;
        else if (field.type !== 'file') copy.value = field.value;
      });
      const scrollers = [node, ...node.querySelectorAll('*')].map(el => el.scrollTop);

      ghost.classList.add('is-leaving');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('inert', '');
      ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      ghost.querySelectorAll('[role]').forEach(el => el.removeAttribute('role'));

      // Микрозадача выполняется после того, как React закончит коммит, но до отрисовки кадра.
      // Если узел всё ещё в документе — это была проверка эффектов StrictMode, а не закрытие.
      queueMicrotask(() => {
        if (node.isConnected) return;
        document.body.appendChild(ghost);
        [ghost, ...ghost.querySelectorAll('*')].forEach((el, i) => {
          if (scrollers[i]) el.scrollTop = scrollers[i];
        });
        setTimeout(() => ghost.remove(), EXIT_MS);
      });
    };
  }, [ref]);
}

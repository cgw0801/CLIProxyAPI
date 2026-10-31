import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { lockScroll, unlockScroll } from '@/components/ui/scrollLock';
import { useNotificationStore } from '@/stores';
import styles from './ActionFeedbackModal.module.scss';

export function ActionFeedbackModal() {
  const { t } = useTranslation();
  const feedback = useNotificationStore((state) => state.actionFeedback);
  const hideFeedback = useNotificationStore((state) => state.hideActionFeedback);
  const options = feedback.options;
  const isOpen = feedback.isOpen && Boolean(options);

  useEffect(() => {
    if (!isOpen || !options) return;

    lockScroll();
    const autoCloseTimer =
      options.variant === 'success' && options.autoCloseMs
        ? window.setTimeout(hideFeedback, options.autoCloseMs)
        : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideFeedback();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unlockScroll();
      if (autoCloseTimer !== null) window.clearTimeout(autoCloseTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hideFeedback, isOpen, options]);

  if (!isOpen || !options) return null;

  const isSuccess = options.variant === 'success';
  const title = options.title ?? (isSuccess ? t('common.success') : t('common.error'));

  const content = (
    <div className={styles.overlay} role="presentation" onMouseDown={hideFeedback}>
      <div
        className={`${styles.card} ${isSuccess ? styles.success : styles.error}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="action-feedback-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className={styles.halo} aria-hidden="true" />
        <span className={styles.iconWrap} aria-hidden="true">
          <svg className={styles.mark} viewBox="0 0 64 64" fill="none">
            <circle className={styles.circle} cx="32" cy="32" r="25" />
            {isSuccess ? (
              <path className={styles.tick} d="M20 33.5 28.2 41.5 44.5 23.5" />
            ) : (
              <path className={styles.cross} d="M23 23 41 41M41 23 23 41" />
            )}
          </svg>
        </span>
        <h2 id="action-feedback-title" className={styles.title}>
          {title}
        </h2>
        {options.message ? <p className={styles.message}>{options.message}</p> : null}
        {options.detail ? <code className={styles.detail}>{options.detail}</code> : null}
        <button type="button" className={styles.button} onClick={hideFeedback}>
          {t('common.confirm')}
        </button>
        {isSuccess && options.autoCloseMs ? (
          <span
            className={styles.progress}
            style={{ animationDuration: `${options.autoCloseMs}ms` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}

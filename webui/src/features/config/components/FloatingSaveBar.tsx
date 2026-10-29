import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconCheck } from '@/components/ui/icons';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import type { ConfigStatusTone } from '../uiState';
import styles from './FloatingSaveBar.module.scss';

export type FloatingSaveBarProps = {
  /** 有未保存修改时可见（与未保存离开守卫的 block 条件一致）。 */
  visible: boolean;
  statusText: string;
  statusTone: ConfigStatusTone;
  saving: boolean;
  saveDisabled: boolean;
  discardDisabled: boolean;
  onSave: () => void;
  onDiscard: () => void;
};

/** 悬浮保存栏：仅在存在未保存修改时出现，并同步高度给页面底部留白。 */
export function FloatingSaveBar(props: FloatingSaveBarProps) {
  const {
    visible,
    statusText,
    statusTone,
    saving,
    saveDisabled,
    discardDisabled,
    onSave,
    onDiscard,
  } = props;
  const { t } = useTranslation();

  const containerRef = useRef<HTMLDivElement | null>(null);
  useActionBarHeightVar(containerRef, '--config-action-bar-height', visible);

  if (!visible || typeof document === 'undefined') return null;

  const toneClass: Record<ConfigStatusTone, string> = {
    error: styles.statusError,
    warning: styles.statusWarning,
    busy: styles.statusBusy,
    muted: styles.statusMuted,
    ok: styles.statusOk,
  };

  return createPortal(
    <div className={styles.container} ref={containerRef}>
      <div className={styles.bar} role="group" aria-label={t('config_management.status_dirty')}>
        <span className={`${styles.status} ${toneClass[statusTone]}`} aria-live="polite">
          {statusText}
        </span>
        <div className={styles.actionsGroup}>
          <button
            type="button"
            className={styles.ghostAction}
            onClick={onDiscard}
            disabled={discardDisabled}
          >
            {t('config_management.actions.discard')}
          </button>
          <button
            type="button"
            className={styles.savePill}
            onClick={onSave}
            disabled={saveDisabled}
          >
            {saving ? <LoadingSpinner size={14} /> : <IconCheck size={15} />}
            {t('config_management.actions.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

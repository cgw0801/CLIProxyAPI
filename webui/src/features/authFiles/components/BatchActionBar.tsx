import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import styles from './BatchActionBar.module.scss';

export type BatchActionBarProps = {
  selectionCount: number;
  selectablePageCount: number;
  selectableFilteredCount: number;
  disableControls: boolean;
  batchStatusDisabled: boolean;
  onSelectPage: () => void;
  onSelectFiltered: () => void;
  onInvertPage: () => void;
  onDeselectAll: () => void;
  onDownload: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
};

/** 悬浮批量操作条：选中项存在时显示，并同步高度给页面底部留白。 */
export function BatchActionBar(props: BatchActionBarProps) {
  const {
    selectionCount,
    selectablePageCount,
    selectableFilteredCount,
    disableControls,
    batchStatusDisabled,
    onSelectPage,
    onSelectFiltered,
    onInvertPage,
    onDeselectAll,
    onDownload,
    onEnable,
    onDisable,
    onDelete,
  } = props;
  const { t } = useTranslation();

  const containerRef = useRef<HTMLDivElement | null>(null);
  useActionBarHeightVar(containerRef, '--auth-files-action-bar-height', selectionCount > 0);

  if (selectionCount <= 0 || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.container} ref={containerRef}>
      <div
        className={styles.bar}
        role="toolbar"
        aria-label={t('auth_files.batch_toolbar_label')}
        aria-orientation="horizontal"
      >
        <div className={styles.left}>
          <span className={styles.count} aria-live="polite">
            {t('auth_files.batch_selected', { count: selectionCount })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={onSelectPage}
            disabled={selectablePageCount === 0}
          >
            {t('auth_files.batch_select_page')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onSelectFiltered}
            disabled={selectableFilteredCount === 0}
          >
            {t('auth_files.batch_select_filtered')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onInvertPage}
            disabled={selectablePageCount === 0}
          >
            {t('auth_files.batch_invert_page')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDeselectAll}>
            {t('auth_files.batch_deselect')}
          </Button>
        </div>
        <div className={styles.right}>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownload}
            disabled={disableControls || selectionCount === 0}
          >
            {t('auth_files.batch_download')}
          </Button>
          <Button size="sm" onClick={onEnable} disabled={batchStatusDisabled}>
            {t('auth_files.batch_enable')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onDisable} disabled={batchStatusDisabled}>
            {t('auth_files.batch_disable')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onDelete}
            disabled={disableControls || selectionCount === 0}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronUp, IconColumns3 } from '@/components/ui/icons';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { REQUEST_COLUMN_KEYS, type RequestColumnKey } from './requestColumns';
import styles from './RequestsColumnToolbar.module.scss';

interface RequestsColumnToolbarProps {
  columnOrder: ReadonlyArray<RequestColumnKey>;
  visibleColumns: ReadonlySet<RequestColumnKey>;
  labels: Readonly<Record<RequestColumnKey, string>>;
  onColumnOrderChange: (next: RequestColumnKey[]) => void;
  onVisibleColumnsChange: (next: Set<RequestColumnKey>) => void;
}

export function RequestsColumnToolbar({
  columnOrder,
  visibleColumns,
  labels,
  onColumnOrderChange,
  onVisibleColumnsChange,
}: RequestsColumnToolbarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<RequestColumnKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const toggleColumn = (key: RequestColumnKey) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onVisibleColumnsChange(next);
  };

  const moveColumn = (key: RequestColumnKey, offset: number) => {
    const from = columnOrder.indexOf(key);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= columnOrder.length) return;
    const next = [...columnOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onColumnOrderChange(next);
  };

  const moveColumnTo = (key: RequestColumnKey, target: RequestColumnKey) => {
    if (key === target) return;
    const from = columnOrder.indexOf(key);
    const to = columnOrder.indexOf(target);
    if (from < 0 || to < 0) return;
    const next = [...columnOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onColumnOrderChange(next);
  };

  const resetColumns = () => {
    onColumnOrderChange([...REQUEST_COLUMN_KEYS]);
    onVisibleColumnsChange(new Set(REQUEST_COLUMN_KEYS));
  };

  const columnsAreDefault = useMemo(
    () =>
      visibleColumns.size === REQUEST_COLUMN_KEYS.length &&
      columnOrder.length === REQUEST_COLUMN_KEYS.length &&
      columnOrder.every((key, index) => key === REQUEST_COLUMN_KEYS[index]),
    [columnOrder, visibleColumns]
  );

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <IconColumns3 size={13} />
        <span>{t('providersPage.toolbar.columnsAndSort')}</span>
        <span className={styles.count}>
          {visibleColumns.size}/{REQUEST_COLUMN_KEYS.length}
        </span>
        <IconChevronDown size={11} />
      </button>
      {open ? (
        <div
          className={styles.panel}
          role="dialog"
          aria-label={t('providersPage.toolbar.columnsAndSort')}
        >
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>{t('providersPage.toolbar.columns')}</span>
            <button
              type="button"
              className={styles.resetButton}
              onClick={resetColumns}
              disabled={columnsAreDefault}
            >
              {t('providersPage.toolbar.resetColumns')}
            </button>
          </div>
          <div className={styles.columnList}>
            {columnOrder.map((key, index) => {
              const isVisible = visibleColumns.has(key);
              const isLastVisible = visibleColumns.size === 1 && isVisible;
              return (
                <div
                  key={key}
                  className={[
                    styles.columnRow,
                    isVisible ? '' : styles.columnRowHidden,
                    draggedColumn === key ? styles.columnRowDragging : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable
                  onDragStart={(event) => {
                    setDraggedColumn(key);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', key);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedColumn) moveColumnTo(draggedColumn, key);
                    setDraggedColumn(null);
                  }}
                  onDragEnd={() => setDraggedColumn(null)}
                >
                  <span
                    className={styles.dragHandle}
                    title={t('providersPage.toolbar.dragColumn')}
                    aria-hidden="true"
                  >
                    ⋮⋮
                  </span>
                  <SelectionCheckbox
                    checked={isVisible}
                    onChange={() => toggleColumn(key)}
                    label={<span className={styles.columnLabel}>{labels[key]}</span>}
                    ariaLabel={`${t('providersPage.toolbar.columns')}: ${labels[key]}`}
                    title={isLastVisible ? t('providersPage.toolbar.lastColumnHint') : undefined}
                    disabled={isLastVisible}
                    className={styles.columnOption}
                  />
                  <div className={styles.columnMoveGroup}>
                    <button
                      type="button"
                      className={styles.columnMoveButton}
                      onClick={() => moveColumn(key, -1)}
                      disabled={index === 0}
                      aria-label={`${t('providersPage.toolbar.moveColumnUp')}: ${labels[key]}`}
                      title={t('providersPage.toolbar.moveColumnUp')}
                    >
                      <IconChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      className={styles.columnMoveButton}
                      onClick={() => moveColumn(key, 1)}
                      disabled={index === columnOrder.length - 1}
                      aria-label={`${t('providersPage.toolbar.moveColumnDown')}: ${labels[key]}`}
                      title={t('providersPage.toolbar.moveColumnDown')}
                    >
                      <IconChevronDown size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className={styles.hint}>{t('providersPage.toolbar.columnOrderHint')}</div>
        </div>
      ) : null}
    </div>
  );
}

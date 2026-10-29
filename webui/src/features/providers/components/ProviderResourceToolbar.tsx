import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconChevronDown,
  IconChevronUp,
  IconColumns3,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  PROVIDER_COLUMN_KEYS,
  type ProviderColumnKey,
  type ProviderSortBy,
  type SortDir,
} from '../types';
import styles from './ProviderResourceToolbar.module.scss';

interface ProviderResourceToolbarProps {
  sortBy: ProviderSortBy;
  sortDir: SortDir;
  onSortBy: (value: ProviderSortBy) => void;
  onSortDir: (value: SortDir) => void;
  availableModels: ReadonlyArray<string>;
  selectedModels: ReadonlySet<string>;
  onSelectedModelsChange: (next: Set<string>) => void;
  columnOrder: ReadonlyArray<ProviderColumnKey>;
  visibleColumns: ReadonlySet<ProviderColumnKey>;
  onColumnOrderChange: (next: ProviderColumnKey[]) => void;
  onVisibleColumnsChange: (next: Set<ProviderColumnKey>) => void;
}

export function ProviderResourceToolbar({
  sortBy,
  sortDir,
  onSortBy,
  onSortDir,
  availableModels,
  selectedModels,
  onSelectedModelsChange,
  columnOrder,
  visibleColumns,
  onColumnOrderChange,
  onVisibleColumnsChange,
}: ProviderResourceToolbarProps) {
  const { t } = useTranslation();
  const [filterOpen, setFilterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<ProviderColumnKey | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const sortOptions = useMemo(
    () => [
      { value: 'name', label: t('providersPage.toolbar.sort.name') },
      { value: 'priority', label: t('providersPage.toolbar.sort.priority') },
      {
        value: 'recent-success',
        label: t('providersPage.toolbar.sort.recentSuccess'),
      },
    ],
    [t]
  );

  const columnLabels = useMemo<Record<ProviderColumnKey, string>>(
    () => ({
      note: t('providersPage.table.note'),
      key: t('providersPage.table.key'),
      modelList: t('providersPage.table.modelList'),
      baseUrl: t('providersPage.table.baseUrl'),
      prefix: t('providersPage.table.prefix'),
      priority: t('common.priority'),
      models: t('providersPage.table.models'),
      status: t('providersPage.table.status'),
    }),
    [t]
  );

  useEffect(() => {
    if (!filterOpen && !settingsOpen) return;
    const onClickOutside = (e: PointerEvent) => {
      if (!(e.target instanceof Element)) return;
      const target = e.target;
      if (target.closest('[data-ui-select-dropdown]')) return;
      if (filterOpen && containerRef.current && !containerRef.current.contains(target)) {
        setFilterOpen(false);
      }
      if (settingsOpen && settingsRef.current && !settingsRef.current.contains(target)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onClickOutside);
    return () => document.removeEventListener('pointerdown', onClickOutside);
  }, [filterOpen, settingsOpen]);

  const toggleModel = (name: string) => {
    const next = new Set(selectedModels);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSelectedModelsChange(next);
  };

  const selectAll = () => onSelectedModelsChange(new Set(availableModels));
  const clearAll = () => onSelectedModelsChange(new Set());

  const toggleColumn = (key: ProviderColumnKey) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onVisibleColumnsChange(next);
  };

  const moveColumn = (key: ProviderColumnKey, offset: number) => {
    const from = columnOrder.indexOf(key);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= columnOrder.length) return;
    const next = [...columnOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onColumnOrderChange(next);
  };

  const moveColumnTo = (key: ProviderColumnKey, target: ProviderColumnKey) => {
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
    onColumnOrderChange([...PROVIDER_COLUMN_KEYS]);
    onVisibleColumnsChange(new Set(PROVIDER_COLUMN_KEYS));
  };
  const allColumnsVisible = visibleColumns.size === PROVIDER_COLUMN_KEYS.length;
  const columnsAreDefault =
    allColumnsVisible &&
    columnOrder.length === PROVIDER_COLUMN_KEYS.length &&
    columnOrder.every((key, index) => key === PROVIDER_COLUMN_KEYS[index]);

  const filterLabel =
    selectedModels.size === 0
      ? t('providersPage.toolbar.filter.allModels')
      : t('providersPage.toolbar.filter.selectedModels', {
          selected: selectedModels.size,
          total: availableModels.length,
        });

  return (
    <div className={styles.root}>
      <div className={styles.settingsGroup} ref={settingsRef}>
        <button
          type="button"
          className={styles.settingsTrigger}
          onClick={() => setSettingsOpen((value) => !value)}
          aria-expanded={settingsOpen}
          aria-haspopup="dialog"
        >
          <IconColumns3 size={14} />
          <span>{t('providersPage.toolbar.columnsAndSort')}</span>
          <span className={styles.settingsCount}>
            {visibleColumns.size}/{PROVIDER_COLUMN_KEYS.length}
          </span>
          <IconChevronDown size={12} />
        </button>
        {settingsOpen ? (
          <div
            className={`${styles.filterPanel} ${styles.settingsPanel}`}
            role="dialog"
            aria-label={t('providersPage.toolbar.columnsAndSort')}
          >
            <div className={styles.settingsSection}>
              <span className={styles.sectionTitle}>{t('providersPage.toolbar.sortBy')}</span>
              <div className={styles.sortControls}>
                <div className={styles.sortSelect}>
                  <Select
                    value={sortBy}
                    options={sortOptions}
                    onChange={(value) => onSortBy(value as ProviderSortBy)}
                    ariaLabel={t('providersPage.toolbar.sortBy')}
                    size="sm"
                  />
                </div>
                <button
                  type="button"
                  className={styles.dirBtn}
                  onClick={() => onSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                  aria-label={
                    sortDir === 'asc'
                      ? t('providersPage.toolbar.sort.directionAsc')
                      : t('providersPage.toolbar.sort.directionDesc')
                  }
                  title={
                    sortDir === 'asc'
                      ? t('providersPage.toolbar.sort.directionAsc')
                      : t('providersPage.toolbar.sort.directionDesc')
                  }
                >
                  {sortDir === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                </button>
              </div>
            </div>
            <div className={styles.settingsDivider} />
            <div className={styles.settingsSection}>
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
                        label={<span className={styles.columnLabel}>{columnLabels[key]}</span>}
                        ariaLabel={`${t('providersPage.toolbar.columns')}: ${columnLabels[key]}`}
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
                          aria-label={`${t('providersPage.toolbar.moveColumnUp')}: ${columnLabels[key]}`}
                          title={t('providersPage.toolbar.moveColumnUp')}
                        >
                          <IconChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className={styles.columnMoveButton}
                          onClick={() => moveColumn(key, 1)}
                          disabled={index === columnOrder.length - 1}
                          aria-label={`${t('providersPage.toolbar.moveColumnDown')}: ${columnLabels[key]}`}
                          title={t('providersPage.toolbar.moveColumnDown')}
                        >
                          <IconChevronDown size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={styles.settingsHint}>
                {t('providersPage.toolbar.columnOrderHint')}
              </div>
              <div className={styles.settingsHint}>{t('providersPage.toolbar.priorityHint')}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.filterGroup} ref={containerRef}>
        <button
          type="button"
          className={styles.filterTrigger}
          onClick={() => setFilterOpen((v) => !v)}
          aria-expanded={filterOpen}
          disabled={availableModels.length === 0}
        >
          <IconSlidersHorizontal size={14} />
          <span>{filterLabel}</span>
          <IconChevronDown size={12} />
        </button>
        {filterOpen ? (
          <div className={styles.filterPanel}>
            <div className={styles.filterToolbar}>
              <button
                type="button"
                className={styles.filterToolbarBtn}
                onClick={selectAll}
                disabled={availableModels.length === 0}
              >
                {t('providersPage.toolbar.filter.selectAll')}
              </button>
              <button
                type="button"
                className={styles.filterToolbarBtn}
                onClick={clearAll}
                disabled={selectedModels.size === 0}
              >
                {t('providersPage.toolbar.filter.clear')}
              </button>
            </div>
            {availableModels.length === 0 ? (
              <div className={styles.filterEmpty}>{t('providersPage.toolbar.filter.empty')}</div>
            ) : (
              <ul className={styles.filterList}>
                {availableModels.map((name) => (
                  <li key={name} className={styles.filterItem}>
                    <SelectionCheckbox
                      checked={selectedModels.has(name)}
                      onChange={() => toggleModel(name)}
                      label={<span className={styles.filterItemLabel}>{name}</span>}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

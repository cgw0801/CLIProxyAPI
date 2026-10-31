import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconSearch } from '@/components/ui/icons';
import { NAV_GROUPS, type NavItem } from './navigation';
import styles from './CommandPalette.module.scss';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface PaletteResult {
  groupLabelKey: string;
  item: NavItem;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo<PaletteResult[]>(() => {
    const needle = query.trim().toLowerCase();
    return NAV_GROUPS.flatMap((group) =>
      group.items
        .filter((item) => {
          if (!needle) return true;
          const label = t(item.labelKey).toLowerCase();
          const description = t(item.descriptionKey).toLowerCase();
          return (
            label.includes(needle) || description.includes(needle) || item.path.includes(needle)
          );
        })
        .map((item) => ({ groupLabelKey: group.labelKey, item }))
    );
  }, [query, t]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(results.length - 1, 0)));
  }, [results.length]);

  if (!open) return null;

  const selectResult = (result: PaletteResult | undefined) => {
    if (!result) return;
    navigate(result.item.path);
    onClose();
  };

  let previousGroup: string | null = null;

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label={t('sidebar.subtitle')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.searchRow}>
          <IconSearch size={18} />
          <input
            ref={inputRef}
            value={query}
            placeholder={t('common.search')}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) =>
                  results.length === 0 ? 0 : (index + 1) % results.length
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) =>
                  results.length === 0 ? 0 : (index - 1 + results.length) % results.length
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                selectResult(results[activeIndex]);
              }
            }}
            aria-label={t('common.search')}
          />
          <kbd>Esc</kbd>
        </div>

        <div className={styles.results}>
          {results.length === 0 ? (
            <p className={styles.empty}>{t('common.no_results')}</p>
          ) : (
            results.map((result, index) => {
              const groupLabel = t(result.groupLabelKey);
              const showGroup = groupLabel !== previousGroup;
              previousGroup = groupLabel;
              return (
                <div key={result.item.path} className={styles.resultBlock}>
                  {showGroup ? <span className={styles.groupLabel}>{groupLabel}</span> : null}
                  <button
                    type="button"
                    className={`${styles.result} ${index === activeIndex ? styles.resultActive : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectResult(result)}
                  >
                    <span className={styles.resultIcon}>
                      <result.item.icon size={17} />
                    </span>
                    <span className={styles.resultCopy}>
                      <strong>{t(result.item.labelKey)}</strong>
                      <small>{t(result.item.descriptionKey)}</small>
                    </span>
                    <span className={styles.resultPath}>{result.item.path}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

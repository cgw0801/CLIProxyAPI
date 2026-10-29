import { useTranslation } from 'react-i18next';
import type { ProviderBrand, ProviderGroup } from '../types';
import styles from './ProviderCategoryList.module.scss';

interface ProviderCategoryListProps {
  groups: ProviderGroup[];
  activeBrand: ProviderBrand;
  onSelect: (brand: ProviderBrand) => void;
}

export function ProviderCategoryList({ groups, activeBrand, onSelect }: ProviderCategoryListProps) {
  const { t } = useTranslation();

  const renderGroups = (items: ProviderGroup[]) => (
    <div className={styles.list}>
      {items.map((group, index) => {
        const active = group.id === activeBrand;
        const total = group.resources.length;
        const activeCount = group.resources.filter((resource) => !resource.disabled).length;
        const itemClass = [styles.item, active ? styles.active : ''].filter(Boolean).join(' ');

        return (
          <button
            key={group.id}
            type="button"
            className={itemClass}
            onClick={() => onSelect(group.id)}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.itemIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.itemLeft}>
              <span className={styles.itemText}>
                <span className={styles.itemTitle}>
                  {t(`providersPage.providerNames.${group.id}`)}
                </span>
                <span className={styles.itemSubtitle}>
                  {t('providersPage.categories.activeCount', {
                    active: activeCount,
                    total,
                  })}
                </span>
              </span>
            </span>
            <span
              className={[styles.badge, total === 0 ? styles.badgeAmber : '']
                .filter(Boolean)
                .join(' ')}
            >
              {total}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={styles.stack}>
      <aside className={styles.aside}>
        <div className={styles.asideHeader}>
          <p className={styles.eyebrow}>{t('providersPage.categories.title')}</p>
          <span className={styles.matrixIndex}>{String(groups.length).padStart(2, '0')}</span>
        </div>
        <p className={styles.asideCaption}>{t('nav_meta.ai_providers')}</p>
        {renderGroups(groups)}
      </aside>
    </div>
  );
}

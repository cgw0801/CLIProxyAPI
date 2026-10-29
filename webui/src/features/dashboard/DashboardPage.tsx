import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { formatCompactNumber, formatDateValue, formatPercent } from '@/utils/format';
import { useDashboardOverview } from './hooks/useDashboardOverview';
import { Meter } from './components/Meter';
import { ThroughputChart } from './components/ThroughputChart';
import { providerLabel, splitWindowMinutes, toneForSuccessRate } from './utils';
import styles from './dashboard.module.scss';

const DASH = '—';

const formatHeadline = (value: number): string =>
  value < 100_000 ? value.toLocaleString() : formatCompactNumber(value);

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);

  const { connectionStatus, connected, config, counts, traffic, providers, credentials, refresh } =
    useDashboardOverview();

  useHeaderRefresh(refresh, connected);

  const windowLabel = useMemo(() => {
    if (traffic.windowMinutes <= 0) return DASH;
    const { hours, minutes } = splitWindowMinutes(traffic.windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [traffic.windowMinutes, t]);

  const routingStrategy = useMemo(() => {
    const raw = config?.routingStrategy?.trim() ?? '';
    if (!raw) return DASH;
    if (raw === 'round-robin') return t('basic_settings.routing_strategy_round_robin');
    if (raw === 'weighted-round-robin') {
      return t('basic_settings.routing_strategy_weighted_round_robin');
    }
    if (raw === 'fill-first') return t('basic_settings.routing_strategy_fill_first');
    return raw;
  }, [config?.routingStrategy, t]);

  const unknownProviderLabel = t('dashboard.provider_unknown');
  const successRateTone = toneForSuccessRate(traffic.successRate);
  const connectionLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );

  const statTiles = [
    {
      key: 'requests',
      label: t('dashboard.hero_requests_label'),
      value: connected ? formatHeadline(traffic.total) : DASH,
      hint: t('dashboard.hero_window_meta', { window: windowLabel }),
      meter: null,
      tone: undefined,
    },
    {
      key: 'success',
      label: t('dashboard.success_rate'),
      value: traffic.successRate === null ? DASH : formatPercent(traffic.successRate),
      hint: t('dashboard.stat_success_hint', { total: traffic.total.toLocaleString() }),
      meter: traffic.successRate,
      tone: successRateTone,
    },
    {
      key: 'credentials',
      label: t('dashboard.stat_credentials'),
      value: credentials ? credentials.total.toLocaleString() : DASH,
      hint: credentials
        ? t('dashboard.stat_credentials_hint', {
            active: credentials.active,
            disabled: credentials.disabled + credentials.unavailable,
          })
        : t('dashboard.stat_credentials_empty'),
      meter:
        credentials && credentials.total > 0
          ? (credentials.active / credentials.total) * 100
          : null,
      tone: undefined,
    },
    {
      key: 'models',
      label: t('dashboard.stat_models'),
      value: counts.models === null ? DASH : counts.models.toLocaleString(),
      hint: t('dashboard.stat_models_hint'),
      meter: null,
      tone: undefined,
    },
  ];

  const runtimeRows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t('dashboard.runtime_routing'), value: routingStrategy },
    { label: t('dashboard.runtime_retry'), value: String(config?.requestRetry ?? 0) },
    {
      label: t('dashboard.runtime_management_keys'),
      value: counts.managementKeys === null ? DASH : String(counts.managementKeys),
    },
    { label: t('dashboard.runtime_version'), value: serverVersion?.trim() || DASH },
    {
      label: t('dashboard.runtime_build'),
      value: formatDateValue(serverBuildDate, i18n.language) || DASH,
    },
    { label: t('dashboard.runtime_proxy'), value: config?.proxyUrl?.trim() || DASH, mono: true },
  ];

  const runtimeToggles = config
    ? [
        { label: t('dashboard.runtime_debug'), on: Boolean(config.debug) },
        { label: t('dashboard.runtime_file_logging'), on: Boolean(config.loggingToFile) },
        { label: t('dashboard.runtime_request_log'), on: Boolean(config.requestLog) },
        { label: t('dashboard.runtime_ws_auth'), on: Boolean(config.wsAuth) },
        { label: t('dashboard.runtime_model_prefix'), on: Boolean(config.forceModelPrefix) },
      ]
    : [];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.titleBlock}>
          <h1>{t('nav.dashboard')}</h1>
          <p>
            {connectionLabel}
            {serverVersion ? ` · v${serverVersion.trim().replace(/^[vV]+/, '')}` : ''}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link to="/logs" className={styles.secondaryButton}>
            {t('dashboard.cta_inspect_logs')}
          </Link>
          <Link to="/ai-providers" className={styles.primaryButton}>
            {t('dashboard.cta_manage_providers')}
          </Link>
        </div>
      </header>

      <section className={styles.stats} aria-label={t('dashboard.stats_aria')}>
        {statTiles.map((tile) => (
          <article key={tile.key} className={styles.statCard}>
            <span className={styles.statLabel}>{tile.label}</span>
            <strong className={styles.statValue}>{tile.value}</strong>
            <span className={styles.statHint}>{tile.hint}</span>
            {tile.meter !== null && tile.meter !== undefined ? (
              <Meter
                value={tile.meter}
                tone={tile.tone}
                ariaLabel={tile.label}
                className={styles.statMeter}
              />
            ) : null}
          </article>
        ))}
      </section>

      <section className={styles.topGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2>{t('dashboard.traffic_title')}</h2>
              <p>{t('dashboard.traffic_description', { window: windowLabel })}</p>
            </div>
          </header>
          <ThroughputChart traffic={traffic} />
        </article>

        <aside className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2>{t('dashboard.runtime_title')}</h2>
              <p>{t('dashboard.runtime_eyebrow')}</p>
            </div>
            <Link to="/config" className={styles.textLink}>
              {t('dashboard.runtime_link')}
            </Link>
          </header>
          <dl className={styles.runtimeList}>
            {runtimeRows.map((row) => (
              <div key={row.label} className={styles.runtimeRow}>
                <dt>{row.label}</dt>
                <dd className={row.mono ? styles.mono : undefined}>{row.value}</dd>
              </div>
            ))}
          </dl>
          {runtimeToggles.length > 0 ? (
            <ul className={styles.flagList}>
              {runtimeToggles.map((toggle) => (
                <li key={toggle.label} className={styles.flagItem}>
                  <span>{toggle.label}</span>
                  <b data-on={toggle.on}>{toggle.on ? t('common.yes') : t('common.no')}</b>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2>{t('dashboard.fleet_title')}</h2>
              <p>{t('dashboard.fleet_description')}</p>
            </div>
            <Link to="/ai-providers" className={styles.textLink}>
              {t('nav.ai_providers')}
            </Link>
          </header>
          {providers.length === 0 ? (
            <p className={styles.emptyNote}>{t('dashboard.fleet_empty')}</p>
          ) : (
            <div className={styles.providerTable}>
              <div className={`${styles.providerRow} ${styles.providerHeadRow}`}>
                <span>{t('nav.ai_providers')}</span>
                <span>{t('dashboard.stat_credentials')}</span>
                <span>{t('dashboard.fleet_requests')}</span>
                <span>{t('dashboard.success_rate')}</span>
              </div>
              {providers.map((provider) => (
                <div key={provider.id} className={styles.providerRow}>
                  <span className={styles.providerName}>
                    {providerLabel(provider.id, unknownProviderLabel)}
                  </span>
                  <span>{provider.credentials.toLocaleString()}</span>
                  <span>{provider.total.toLocaleString()}</span>
                  <span className={styles.providerRate}>
                    {provider.successRate === null ? DASH : formatPercent(provider.successRate)}
                    <Meter
                      value={provider.successRate}
                      ariaLabel={t('dashboard.success_rate')}
                      className={styles.providerMeter}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2>{t('dashboard.health_title')}</h2>
              <p>{t('dashboard.health_eyebrow')}</p>
            </div>
            <Link to="/auth-files" className={styles.textLink}>
              {t('dashboard.health_link')}
            </Link>
          </header>
          {!credentials || credentials.total === 0 ? (
            <p className={styles.emptyNote}>{t('dashboard.health_empty')}</p>
          ) : (
            <>
              <div className={styles.healthBar}>
                {credentials.active > 0 ? (
                  <span
                    className={`${styles.healthSegment} ${styles.healthActive}`}
                    style={{ flexGrow: credentials.active }}
                  />
                ) : null}
                {credentials.unavailable > 0 ? (
                  <span
                    className={`${styles.healthSegment} ${styles.healthUnavailable}`}
                    style={{ flexGrow: credentials.unavailable }}
                  />
                ) : null}
                {credentials.disabled > 0 ? (
                  <span
                    className={`${styles.healthSegment} ${styles.healthDisabled}`}
                    style={{ flexGrow: credentials.disabled }}
                  />
                ) : null}
              </div>
              <ul className={styles.healthLegend}>
                <li>
                  <i className={`${styles.healthKey} ${styles.healthActive}`} aria-hidden="true" />
                  {t('dashboard.health_active')}
                  <b>{credentials.active.toLocaleString()}</b>
                </li>
                <li>
                  <i
                    className={`${styles.healthKey} ${styles.healthUnavailable}`}
                    aria-hidden="true"
                  />
                  {t('dashboard.health_unavailable')}
                  <b>{credentials.unavailable.toLocaleString()}</b>
                </li>
                <li>
                  <i className={`${styles.healthKey} ${styles.healthDisabled}`} aria-hidden="true" />
                  {t('dashboard.health_disabled')}
                  <b>{credentials.disabled.toLocaleString()}</b>
                </li>
              </ul>
              {credentials.byType.length > 0 ? (
                <div className={styles.typeBreakdown}>
                  <span>{t('dashboard.health_by_type')}</span>
                  <ul className={styles.typeList}>
                    {credentials.byType.map((entry) => (
                      <li key={entry.type} className={styles.typeChip}>
                        {providerLabel(entry.type, unknownProviderLabel)}
                        <b>{entry.count.toLocaleString()}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </article>
      </section>
    </div>
  );
}

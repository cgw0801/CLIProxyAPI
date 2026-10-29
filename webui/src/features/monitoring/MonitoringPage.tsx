import {
  Fragment,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore } from '@/stores';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import {
  monitoringApi,
  type MonitoringEvent,
  type MonitoringGroupSummary,
  type MonitoringOption,
  type MonitoringOverview,
  type MonitoringRange,
} from '@/services/api/monitoring';
import styles from './MonitoringPage.module.scss';
import { RequestsColumnToolbar } from './RequestsColumnToolbar';
import {
  REQUEST_COLUMN_KEYS,
  readRequestColumnsState,
  writeRequestColumnsState,
  type RequestColumnKey,
  type RequestColumnsState,
} from './requestColumns';

const DASH = '—';

const DURATION_WARNING_MS = 15_000;
const DURATION_CRITICAL_MS = 30_000;

const RANGE_OPTIONS: Array<{ value: MonitoringRange; labelKey: string }> = [
  { value: '1h', labelKey: 'monitoring.range_1h' },
  { value: '24h', labelKey: 'monitoring.range_24h' },
  { value: '7d', labelKey: 'monitoring.range_7d' },
  { value: '30d', labelKey: 'monitoring.range_30d' },
  { value: 'all', labelKey: 'monitoring.range_all' },
];

const REQUEST_COLUMN_CLASS_NAMES: Record<RequestColumnKey, string> = {
  apiKey: styles.colKey,
  model: styles.colModel,
  reasoning: styles.colSettings,
  recentStatus: styles.colRecent,
  status: styles.colStatus,
  successRate: styles.colRate,
  calls: styles.colCalls,
  tps: styles.colTps,
  cacheRate: styles.colCache,
  latency: styles.colLatency,
  time: styles.colTime,
};

const cx = (...values: Array<string | false | null | undefined>): string =>
  values.filter(Boolean).join(' ');

const formatDuration = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return DASH;
  if (value < 1000) return Math.round(value) + ' ms';
  const seconds = value / 1000;
  return (seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString()) + ' s';
};

const durationToneClass = (value: number | null | undefined): string | undefined => {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  if (value >= DURATION_CRITICAL_MS) return styles.durationBad;
  if (value >= DURATION_WARNING_MS) return styles.durationWarn;
  return styles.durationGood;
};

const formatTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface CacheRateTotals {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
}

const formatCacheRate = (totals: CacheRateTotals): string => {
  const cacheRead = Math.max(totals.cache_read_tokens, 0);
  const cached = Math.max(totals.cached_tokens, 0);
  const cacheCreation = Math.max(totals.cache_creation_tokens, 0);
  const hitTokens = cacheRead > 0 ? cacheRead : cacheCreation === 0 ? cached : 0;
  const reportedInput = Math.max(totals.total_tokens - totals.output_tokens, 0);
  const inputTokens = Math.max(totals.input_tokens, reportedInput, hitTokens);
  if (inputTokens <= 0) return DASH;
  return formatPercent(Math.min(hitTokens / inputTokens, 1) * 100, 1);
};

const optionList = (items: MonitoringOption[] | undefined, fallback: string) => [
  { value: '', label: fallback },
  ...(items ?? []).map((item) => ({ value: item.value, label: item.label || item.value })),
];

type TabKey = 'requests' | 'accounts' | 'api_keys';

interface LoadOptions {
  silent?: boolean;
}

export function MonitoringPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();
  const connected = connectionStatus === 'connected';

  const [range, setRange] = useState<MonitoringRange>('24h');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [account, setAccount] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput.trim());
  const [activeTab, setActiveTab] = useState<TabKey>('requests');
  const [requestColumns, setRequestColumns] =
    useState<RequestColumnsState>(readRequestColumnsState);
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestSeq = useRef(0);
  const dataRef = useRef<MonitoringOverview | null>(null);
  const requestVisibleColumns = useMemo(
    () => new Set<RequestColumnKey>(requestColumns.visible),
    [requestColumns.visible]
  );

  useEffect(() => {
    writeRequestColumnsState(requestColumns);
  }, [requestColumns]);

  const handleRequestColumnOrderChange = useCallback((order: RequestColumnKey[]) => {
    setRequestColumns((current) => ({ ...current, order }));
  }, []);

  const handleRequestVisibleColumnsChange = useCallback((visibleColumns: Set<RequestColumnKey>) => {
    setRequestColumns((current) => ({
      ...current,
      visible: REQUEST_COLUMN_KEYS.filter((key) => visibleColumns.has(key)),
    }));
  }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback(
    async (options: LoadOptions = {}) => {
      if (!connected) {
        setLoading(false);
        return;
      }
      const seq = ++requestSeq.current;
      if (!options.silent) {
        setLoading(true);
        setRefreshing(true);
      }
      setError('');
      try {
        const result = await monitoringApi.overview({
          range,
          provider: provider || undefined,
          model: model || undefined,
          account: account || undefined,
          api_key: apiKey || undefined,
          status: status || undefined,
          search: deferredSearch || undefined,
          page,
          page_size: pageSize,
        });
        if (seq !== requestSeq.current) return;
        if (result.total_pages > 0 && result.page > result.total_pages) {
          setPage(result.total_pages);
          return;
        }
        dataRef.current = result;
        setData(result);
        setLastUpdated(new Date());
      } catch (err) {
        if (seq === requestSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [account, apiKey, connected, deferredSearch, model, page, pageSize, provider, range, status]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useHeaderRefresh(() => load({ silent: true }), connected);

  useEffect(() => {
    if (!autoRefresh || !connected) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load({ silent: true });
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, connected, load]);

  const summary = data?.summary;
  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const providerOptions = useMemo(
    () => optionList(data?.options.providers, t('monitoring.filter_provider')),
    [data?.options.providers, t]
  );
  const modelOptions = useMemo(
    () => optionList(data?.options.models, t('monitoring.filter_model')),
    [data?.options.models, t]
  );
  const accountOptions = useMemo(
    () => optionList(data?.options.accounts, t('monitoring.filter_account')),
    [data?.options.accounts, t]
  );
  const apiKeyOptions = useMemo(
    () => optionList(data?.options.api_keys, t('monitoring.filter_api_key')),
    [data?.options.api_keys, t]
  );
  const statusOptions = useMemo(
    () => [
      { value: '', label: t('monitoring.filter_status') },
      { value: 'success', label: t('monitoring.status_success') },
      { value: 'failed', label: t('monitoring.status_failed') },
    ],
    [t]
  );
  const requestColumnLabels = useMemo<Record<RequestColumnKey, string>>(
    () => ({
      apiKey: t('monitoring.table_api_key'),
      model: t('monitoring.table_model'),
      reasoning: t('monitoring.reasoning_short'),
      recentStatus: t('monitoring.table_recent_status'),
      status: t('monitoring.table_status'),
      successRate: t('monitoring.table_success_rate'),
      calls: t('monitoring.table_calls'),
      tps: t('monitoring.table_tps'),
      cacheRate: t('monitoring.table_cache_rate'),
      latency: t('monitoring.table_duration'),
      time: t('monitoring.table_time'),
    }),
    [t]
  );

  const hasFilters = Boolean(provider || model || account || apiKey || status || searchInput);
  const clearFilters = () => {
    setProvider('');
    setModel('');
    setAccount('');
    setApiKey('');
    setStatus('');
    setSearchInput('');
    setPage(1);
  };

  const handleClear = () => {
    showConfirmation({
      title: t('monitoring.clear_title'),
      message: t('monitoring.clear_message'),
      confirmText: t('monitoring.clear'),
      variant: 'danger',
      onConfirm: async () => {
        const result = await monitoringApi.clear();
        showNotification(t('monitoring.cleared', { count: result.removed }), 'success');
        setExpandedId(null);
        await load({ silent: true });
      },
    });
  };

  const selectAccount = (key: string) => {
    if (!key || key === 'unknown') return;
    setAccount(key);
    setActiveTab('requests');
  };

  const selectApiKey = (key: string) => {
    if (!key || key === 'unknown') return;
    setApiKey(key);
    setActiveTab('requests');
  };

  const summaryItems = [
    {
      key: 'requests',
      label: t('monitoring.summary_requests'),
      value: summary ? formatCompactNumber(summary.requests) : DASH,
      hint: summary ? t('monitoring.summary_stream_hint', { count: summary.stream_requests }) : '',
    },
    {
      key: 'success',
      label: t('monitoring.summary_success_rate'),
      value: summary ? formatPercent(summary.success_rate, 1) : DASH,
      hint: summary ? t('monitoring.summary_success_hint', { count: summary.success }) : '',
    },
    {
      key: 'failed',
      label: t('monitoring.summary_failed'),
      value: summary ? formatCompactNumber(summary.failed) : DASH,
      hint: summary && summary.failed > 0 ? t('monitoring.summary_failed_hint') : '',
    },
    {
      key: 'latency',
      label: t('monitoring.summary_latency'),
      value: summary ? formatDuration(summary.average_latency_ms) : DASH,
      hint: '',
    },
    {
      key: 'tokens',
      label: t('monitoring.summary_tokens'),
      value: summary ? formatCompactNumber(summary.total_tokens) : DASH,
      hint: summary
        ? t('monitoring.summary_tokens_hint', {
            input: formatCompactNumber(summary.input_tokens),
            output: formatCompactNumber(summary.output_tokens),
          })
        : '',
    },
    {
      key: 'cache',
      label: t('monitoring.summary_cache_rate'),
      value: summary ? formatCacheRate(summary) : DASH,
      hint: '',
    },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>{t('monitoring.title')}</h1>
          <p>{t('monitoring.subtitle')}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.rangeBar} role="group" aria-label={t('monitoring.range_label')}>
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx(
                  styles.rangeButton,
                  range === option.value && styles.rangeButtonActive
                )}
                aria-pressed={range === option.value}
                onClick={() => {
                  setRange(option.value);
                  setPage(1);
                }}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
          <label className={styles.autoRefresh}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            <span>{t('monitoring.auto_refresh')}</span>
          </label>
          <div className={styles.actionButtons}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.actionButton}
              onClick={() => void load({ silent: true })}
              disabled={!connected || refreshing}
              aria-busy={refreshing}
            >
              <IconRefreshCw
                size={14}
                className={refreshing ? styles.refreshIconSpinning : undefined}
              />
              <span>{refreshing ? t('monitoring.refreshing') : t('monitoring.refresh')}</span>
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              className={styles.actionButton}
              onClick={handleClear}
              disabled={!connected}
            >
              <IconTrash2 size={14} />
              <span>{t('monitoring.clear')}</span>
            </Button>
          </div>
        </div>
      </header>

      <section className={styles.summaryStrip} aria-label={t('monitoring.summary_aria')}>
        {summaryItems.map((item) => (
          <div key={item.key} className={styles.summaryItem}>
            <span className={styles.summaryLabel}>{item.label}</span>
            <strong className={styles.summaryValue}>{item.value}</strong>
            {item.hint ? <small className={styles.summaryHint}>{item.hint}</small> : null}
          </div>
        ))}
      </section>

      <section className={styles.toolbar} aria-label={t('monitoring.filters_aria')}>
        <input
          className={styles.searchInput}
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
            setPage(1);
          }}
          placeholder={t('monitoring.search_placeholder')}
          aria-label={t('monitoring.search_placeholder')}
        />
        <Select
          className={styles.filterSelect}
          value={provider}
          options={providerOptions}
          onChange={(value) => {
            setProvider(value);
            setPage(1);
          }}
          placeholder={t('monitoring.filter_provider')}
          ariaLabel={t('monitoring.filter_provider')}
          size="sm"
          fullWidth={false}
        />
        <Select
          className={styles.filterSelect}
          value={model}
          options={modelOptions}
          onChange={(value) => {
            setModel(value);
            setPage(1);
          }}
          placeholder={t('monitoring.filter_model')}
          ariaLabel={t('monitoring.filter_model')}
          size="sm"
          fullWidth={false}
        />
        <Select
          className={styles.filterSelect}
          value={account}
          options={accountOptions}
          onChange={(value) => {
            setAccount(value);
            setPage(1);
          }}
          placeholder={t('monitoring.filter_account')}
          ariaLabel={t('monitoring.filter_account')}
          size="sm"
          fullWidth={false}
        />
        <Select
          className={styles.filterSelect}
          value={apiKey}
          options={apiKeyOptions}
          onChange={(value) => {
            setApiKey(value);
            setPage(1);
          }}
          placeholder={t('monitoring.filter_api_key')}
          ariaLabel={t('monitoring.filter_api_key')}
          size="sm"
          fullWidth={false}
        />
        <Select
          className={styles.filterSelect}
          value={status}
          options={statusOptions}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          placeholder={t('monitoring.filter_status')}
          ariaLabel={t('monitoring.filter_status')}
          size="sm"
          fullWidth={false}
        />
        {hasFilters ? (
          <button type="button" className={styles.textButton} onClick={clearFilters}>
            {t('monitoring.clear_filters')}
          </button>
        ) : null}
        <span className={styles.recordMeta}>
          {lastUpdated
            ? t('monitoring.last_updated', { time: lastUpdated.toLocaleTimeString() })
            : ''}
          {data ? ' · ' + t('monitoring.retained', { count: data.retained }) : ''}
        </span>
      </section>

      <div className={styles.tabsBar}>
        <div className={styles.tabs} role="tablist" aria-label={t('monitoring.tabs_aria')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'requests'}
            className={cx(styles.tab, activeTab === 'requests' && styles.tabActive)}
            onClick={() => setActiveTab('requests')}
          >
            {t('monitoring.tab_requests')}
            <span className={styles.tabCount}>{formatCompactNumber(total)}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'accounts'}
            className={cx(styles.tab, activeTab === 'accounts' && styles.tabActive)}
            onClick={() => setActiveTab('accounts')}
          >
            {t('monitoring.tab_accounts')}
            <span className={styles.tabCount}>
              {formatCompactNumber(data?.accounts.length ?? 0)}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'api_keys'}
            className={cx(styles.tab, activeTab === 'api_keys' && styles.tabActive)}
            onClick={() => setActiveTab('api_keys')}
          >
            {t('monitoring.tab_api_keys')}
            <span className={styles.tabCount}>
              {formatCompactNumber(data?.api_keys.length ?? 0)}
            </span>
          </button>
        </div>
        {activeTab === 'requests' ? (
          <RequestsColumnToolbar
            columnOrder={requestColumns.order}
            visibleColumns={requestVisibleColumns}
            labels={requestColumnLabels}
            onColumnOrderChange={handleRequestColumnOrderChange}
            onVisibleColumnsChange={handleRequestVisibleColumnsChange}
          />
        ) : null}
      </div>

      {error ? (
        <div className={styles.errorBox}>
          {t('monitoring.error')}: {error}
        </div>
      ) : null}

      {loading ? (
        <div className={styles.emptyState}>{t('monitoring.loading')}</div>
      ) : activeTab === 'requests' ? (
        <RequestsTable
          events={events}
          expandedId={expandedId}
          columnOrder={requestColumns.order}
          visibleColumns={requestVisibleColumns}
          columnLabels={requestColumnLabels}
          onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
        />
      ) : activeTab === 'accounts' ? (
        <GroupTable kind="accounts" rows={data?.accounts ?? []} onSelect={selectAccount} />
      ) : (
        <GroupTable kind="api_keys" rows={data?.api_keys ?? []} onSelect={selectApiKey} />
      )}

      {activeTab === 'requests' && !loading && total > 0 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
        />
      ) : null}
    </div>
  );
}

const buildPageItems = (current: number, total: number): Array<number | 'ellipsis'> => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const visible = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) {
    visible.add(2);
    visible.add(3);
    visible.add(4);
  }
  if (current >= total - 2) {
    visible.add(total - 1);
    visible.add(total - 2);
    visible.add(total - 3);
  }
  const pages = [...visible].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const items: Array<number | 'ellipsis'> = [];
  pages.forEach((value, index) => {
    if (index > 0 && value - pages[index - 1] > 1) {
      items.push('ellipsis');
    }
    items.push(value);
  });
  return items;
};

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const { t } = useTranslation();
  const pageItems = useMemo(() => buildPageItems(page, totalPages), [page, totalPages]);

  return (
    <nav className={styles.pagination} aria-label={t('monitoring.pagination_aria')}>
      <div className={styles.pageButtons}>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          {t('monitoring.page_prev')}
        </button>
        {pageItems.map((item, index) =>
          item === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} className={styles.pageEllipsis}>
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={cx(styles.pageButton, item === page && styles.pageButtonActive)}
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          {t('monitoring.page_next')}
        </button>
      </div>
      <span className={styles.pageMeta}>
        {t('monitoring.page_info', { page, total: totalPages, count: total })}
      </span>
      <label className={styles.pageSize}>
        <span>{t('monitoring.page_size')}</span>
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {[20, 50, 100].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}

interface RealtimeRow extends MonitoringEvent {
  streamKey: string;
  requestCount: number;
  successRate: number;
  recentPattern: boolean[];
}

const buildRealtimeRows = (events: MonitoringEvent[]): RealtimeRow[] => {
  const sortedAsc = [...events].sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime();
    const rightTime = new Date(right.timestamp).getTime();
    return leftTime - rightTime || left.id - right.id;
  });
  const metricsByStream = new Map<string, { total: number; success: number; pattern: boolean[] }>();
  const enriched = sortedAsc.map((event) => {
    const streamKey = [
      event.api_key_hash || event.api_key_masked || 'anonymous',
      event.model || '',
      event.reasoning_effort || '',
      event.service_tier || '',
      event.executor_type || event.provider || '',
    ].join('::');
    const previous = metricsByStream.get(streamKey) ?? { total: 0, success: 0, pattern: [] };
    const recentPattern = [...previous.pattern, !event.failed].slice(-10);
    const next = {
      total: previous.total + 1,
      success: previous.success + (event.failed ? 0 : 1),
      pattern: recentPattern,
    };
    metricsByStream.set(streamKey, next);
    return {
      ...event,
      streamKey,
      requestCount: next.total,
      successRate: next.total > 0 ? next.success / next.total : 1,
      recentPattern,
    };
  });
  return enriched.sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime();
    const rightTime = new Date(right.timestamp).getTime();
    return rightTime - leftTime || right.id - left.id;
  });
};

const formatTimeParts = (value: string): { date: string; time: string } => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: DASH, time: DASH };
  return {
    date: date.toLocaleDateString([], { month: '2-digit', day: '2-digit' }),
    time: date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  };
};

interface RequestsTableProps {
  events: MonitoringEvent[];
  expandedId: number | null;
  columnOrder: ReadonlyArray<RequestColumnKey>;
  visibleColumns: ReadonlySet<RequestColumnKey>;
  columnLabels: Readonly<Record<RequestColumnKey, string>>;
  onToggle: (id: number) => void;
}

function RequestsTable({
  events,
  expandedId,
  columnOrder,
  visibleColumns,
  columnLabels,
  onToggle,
}: RequestsTableProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => buildRealtimeRows(events), [events]);
  const orderedColumns = useMemo(
    () => columnOrder.filter((key) => visibleColumns.has(key)),
    [columnOrder, visibleColumns]
  );
  if (rows.length === 0) {
    return <div className={styles.emptyState}>{t('monitoring.empty')}</div>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={cx(styles.table, styles.realtimeTable)}>
        <thead>
          <tr>
            {orderedColumns.map((column) => (
              <th key={column} className={REQUEST_COLUMN_CLASS_NAMES[column]}>
                {columnLabels[column]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => {
            const expanded = expandedId === event.id;
            const requestedModel = event.alias?.trim() || event.model?.trim() || DASH;
            const resolvedModel = event.model?.trim() || '';
            const responseModel = event.response_model?.trim() || '';
            const showResolvedModel = Boolean(resolvedModel && resolvedModel !== requestedModel);
            const hasResponseModelMismatch = Boolean(
              responseModel && resolvedModel && responseModel !== resolvedModel
            );
            const keyLabel = event.api_key_label || event.api_key_masked || DASH;
            const keyDetail =
              event.account_label || event.auth_index || event.api_key_masked || DASH;
            const timeParts = formatTimeParts(event.timestamp);
            const rateTone =
              event.successRate >= 0.95
                ? styles.statusSuccess
                : event.successRate >= 0.85
                  ? styles.warningText
                  : styles.statusFailed;
            const tokensPerSecond = event.tokens_per_second ?? 0;
            const ttftTone = durationToneClass(event.ttft_ms);
            const latencyTone = durationToneClass(event.latency_ms);
            const ttftLabel =
              typeof event.ttft_ms === 'number' ? formatDuration(event.ttft_ms) : DASH;
            const renderCell = (column: RequestColumnKey): ReactNode => {
              switch (column) {
                case 'apiKey':
                  return (
                    <td
                      key={column}
                      className={styles.keyCell}
                      data-label={t('monitoring.table_api_key')}
                      title={[keyLabel, event.api_key_masked, event.account_label]
                        .filter(Boolean)
                        .join(' · ')}
                    >
                      <span className={styles.modelName}>{keyLabel}</span>
                      <small className={styles.cellSub}>{keyDetail}</small>
                    </td>
                  );
                case 'model':
                  return (
                    <td
                      key={column}
                      data-label={t('monitoring.table_model')}
                      title={[
                        requestedModel,
                        showResolvedModel ? `→ ${resolvedModel}` : '',
                        hasResponseModelMismatch ? `↳ ${responseModel}` : '',
                        hasResponseModelMismatch ? t('monitoring.model_mismatch') : '',
                      ]
                        .filter(Boolean)
                        .join('\n')}
                    >
                      <span className={styles.modelName}>{requestedModel}</span>
                      {showResolvedModel ? (
                        <small className={styles.modelSub}>
                          <span className={styles.modelUpstream}>→ {resolvedModel}</span>
                        </small>
                      ) : null}
                      {hasResponseModelMismatch ? (
                        <small className={cx(styles.modelSub, styles.modelResponse)}>
                          <span className={styles.modelUpstream}>↳ {responseModel}</span>
                          <span className={styles.modelMismatch}>
                            {t('monitoring.model_mismatch')}
                          </span>
                        </small>
                      ) : null}
                    </td>
                  );
                case 'reasoning':
                  return (
                    <td key={column} data-label={t('monitoring.reasoning_short')}>
                      <div className={styles.settingCell}>
                        <span className={styles.settingLine}>
                          <strong>{event.reasoning_effort || DASH}</strong>
                        </span>
                      </div>
                    </td>
                  );
                case 'recentStatus':
                  return (
                    <td key={column} data-label={t('monitoring.table_recent_status')}>
                      <div className={styles.recentPattern}>
                        {event.recentPattern.map((success, index) => (
                          <span
                            key={index}
                            className={cx(
                              styles.patternDot,
                              success ? styles.patternSuccess : styles.patternFailed
                            )}
                            title={
                              success
                                ? t('monitoring.pattern_success')
                                : t('monitoring.pattern_failed')
                            }
                          />
                        ))}
                      </div>
                    </td>
                  );
                case 'status':
                  return (
                    <td key={column} data-label={t('monitoring.table_status')}>
                      <span
                        className={cx(
                          styles.status,
                          event.failed ? styles.statusFailed : styles.statusSuccess
                        )}
                      >
                        <span className={styles.statusDot} />
                        {event.failed
                          ? t('monitoring.status_failed')
                          : t('monitoring.status_success')}
                      </span>
                      <small className={styles.statusCode}>HTTP {event.status_code}</small>
                    </td>
                  );
                case 'successRate':
                  return (
                    <td key={column} className={cx(styles.numberCell, rateTone)}>
                      {formatPercent(event.successRate * 100, 1)}
                    </td>
                  );
                case 'calls':
                  return (
                    <td key={column} className={styles.numberCell}>
                      {formatCompactNumber(event.requestCount)}
                    </td>
                  );
                case 'tps':
                  return (
                    <td key={column} className={styles.numberCell}>
                      {tokensPerSecond > 0 ? tokensPerSecond.toFixed(1) : DASH}
                    </td>
                  );
                case 'cacheRate':
                  return (
                    <td key={column} className={styles.numberCell}>
                      {formatCacheRate(event)}
                    </td>
                  );
                case 'latency':
                  return (
                    <td key={column} data-label={t('monitoring.table_latency')}>
                      <div className={styles.metricCell}>
                        <span className={styles.metricLine}>
                          <small>{t('monitoring.detail_ttft')}</small>
                          <strong className={ttftTone}>{ttftLabel}</strong>
                        </span>
                        <span className={styles.metricLine}>
                          <small>{t('monitoring.table_latency')}</small>
                          <strong className={latencyTone}>
                            {formatDuration(event.latency_ms)}
                          </strong>
                        </span>
                      </div>
                    </td>
                  );
                case 'time':
                  return (
                    <td
                      key={column}
                      className={styles.timeCell}
                      data-label={t('monitoring.table_time')}
                      title={new Date(event.timestamp).toLocaleString()}
                    >
                      <span className={styles.timePart}>{timeParts.date}</span>
                      <span className={styles.timePart}>{timeParts.time}</span>
                    </td>
                  );
                default:
                  return null;
              }
            };
            return (
              <Fragment key={event.id}>
                <tr
                  className={cx(styles.dataRow, expanded && styles.dataRowExpanded)}
                  tabIndex={0}
                  onClick={() => onToggle(event.id)}
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                      keyEvent.preventDefault();
                      onToggle(event.id);
                    }
                  }}
                >
                  {orderedColumns.map(renderCell)}
                </tr>
                {expanded ? (
                  <tr className={styles.detailRow}>
                    <td colSpan={Math.max(orderedColumns.length, 1)}>
                      <EventDetail event={event} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EventDetail({ event }: { event: MonitoringEvent }) {
  const { t } = useTranslation();
  const items: Array<{ label: string; value: string; mono: boolean; tone?: string }> = [
    { label: t('monitoring.detail_request_id'), value: event.request_id || DASH, mono: true },
    { label: t('monitoring.detail_trace_id'), value: event.trace_id || DASH, mono: true },
    { label: t('monitoring.detail_endpoint'), value: event.endpoint || DASH, mono: true },
    { label: t('monitoring.detail_status_code'), value: String(event.status_code), mono: true },
    {
      label: t('monitoring.detail_latency'),
      value: formatDuration(event.latency_ms),
      mono: true,
      tone: durationToneClass(event.latency_ms),
    },
    {
      label: t('monitoring.detail_ttft'),
      value: typeof event.ttft_ms === 'number' ? formatDuration(event.ttft_ms) : DASH,
      mono: true,
      tone: durationToneClass(event.ttft_ms),
    },
    {
      label: t('monitoring.detail_tps'),
      value: event.tokens_per_second ? event.tokens_per_second.toFixed(1) + ' tok/s' : DASH,
      mono: true,
    },
    {
      label: t('monitoring.detail_tokens'),
      value: t('monitoring.detail_tokens_value', {
        input: formatCompactNumber(event.input_tokens),
        output: formatCompactNumber(event.output_tokens),
        cache: formatCompactNumber(event.cache_read_tokens + event.cache_creation_tokens),
        reasoning: formatCompactNumber(event.reasoning_tokens),
      }),
      mono: true,
    },
    {
      label: t('monitoring.detail_account'),
      value: event.account_label || event.auth_index || DASH,
      mono: false,
    },
    { label: t('monitoring.table_provider'), value: event.provider || DASH, mono: true },
    { label: t('monitoring.detail_auth_type'), value: event.auth_type || DASH, mono: true },
    {
      label: t('monitoring.detail_api_key'),
      value: event.api_key_label || event.api_key_masked || DASH,
      mono: true,
    },
    { label: t('monitoring.detail_client_ip'), value: event.client_ip || DASH, mono: true },
    { label: t('monitoring.detail_user_agent'), value: event.user_agent || DASH, mono: false },
    { label: t('monitoring.detail_executor'), value: event.executor_type || DASH, mono: true },
    {
      label: t('monitoring.detail_response_model'),
      value: event.response_model || DASH,
      mono: true,
    },
    { label: t('monitoring.detail_reasoning'), value: event.reasoning_effort || DASH, mono: true },
    { label: t('monitoring.detail_service_tier'), value: event.service_tier || DASH, mono: true },
    { label: t('monitoring.detail_source'), value: event.source || DASH, mono: true },
  ];
  return (
    <div className={styles.detail}>
      <div className={styles.detailGrid}>
        {items.map((item) => (
          <div key={item.label} className={styles.detailItem}>
            <span>{item.label}</span>
            <strong className={cx(item.mono && styles.mono, item.tone)}>{item.value}</strong>
          </div>
        ))}
      </div>
      {event.failure_summary ? (
        <div className={styles.failureBox}>
          <span>{t('monitoring.detail_failure')}</span>
          <code>{event.failure_summary}</code>
        </div>
      ) : null}
    </div>
  );
}

interface GroupTableProps {
  kind: TabKey;
  rows: MonitoringGroupSummary[];
  onSelect: (key: string) => void;
}

function GroupTable({ kind, rows, onSelect }: GroupTableProps) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <div className={styles.emptyState}>{t('monitoring.empty')}</div>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>
              {kind === 'accounts' ? t('monitoring.table_account') : t('monitoring.table_api_key')}
            </th>
            <th className={styles.colNumber}>{t('monitoring.table_requests')}</th>
            <th className={styles.colNumber}>{t('monitoring.table_success_rate')}</th>
            <th className={styles.colNumber}>{t('monitoring.table_failed')}</th>
            <th className={styles.colNumber}>{t('monitoring.table_tokens')}</th>
            <th className={styles.colNumber}>{t('monitoring.table_avg_latency')}</th>
            <th className={styles.colTime}>{t('monitoring.table_last_seen')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cx(styles.dataRow, row.key !== 'unknown' && styles.clickableRow)}
              tabIndex={row.key !== 'unknown' ? 0 : undefined}
              onClick={() => onSelect(row.key)}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && row.key !== 'unknown') {
                  event.preventDefault();
                  onSelect(row.key);
                }
              }}
            >
              <td>
                <span className={styles.groupName}>{row.label || row.key}</span>
                {row.detail ? <small className={styles.modelSub}>{row.detail}</small> : null}
              </td>
              <td className={styles.numberCell}>{formatCompactNumber(row.requests)}</td>
              <td className={styles.numberCell}>{formatPercent(row.success_rate, 1)}</td>
              <td className={styles.numberCell}>{formatCompactNumber(row.failed)}</td>
              <td className={styles.numberCell}>{formatCompactNumber(row.total_tokens)}</td>
              <td className={styles.numberCell}>{formatDuration(row.average_latency_ms)}</td>
              <td className={styles.timeCell}>{formatTime(row.last_seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

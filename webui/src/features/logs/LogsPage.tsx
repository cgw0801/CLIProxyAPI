import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { lockScroll, unlockScroll } from '@/components/ui/scrollLock';
import {
  IconCopy,
  IconCode,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconMaximize2,
  IconMinimize2,
  IconRefreshCw,
  IconSearch,
  IconSlidersHorizontal,
  IconTimer,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { logsApi, responseDataToText, type ErrorLogFile } from '@/services/api/logs';
import { useLogStream } from './hooks/useLogStream';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage } from '@/utils/helpers';
import { downloadBlob } from '@/utils/download';
import {
  createLogParserCache,
  searchLogEntries,
  filterLogEntries,
} from '@/features/logs/model/logSelectors';
import { Select } from '@/components/ui/Select';
import { formatUnixTimestamp } from '@/utils/format';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';
import { HTTP_METHODS, STATUS_GROUPS } from './model/logTypes';
import { createLogRequestGuard } from './model/logRequests';
import { errorLogViewerReducer } from './model/errorLogViewer';
import { shouldExitLogFullscreen } from './model/logFullscreen';
import { useLogFilters } from './hooks/useLogFilters';
import styles from './LogsPage.module.scss';

const LOG_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_LOG_PAGE_SIZE = 100;

const isNearBottom = (node: HTMLDivElement | null) =>
  !node || node.scrollHeight - node.scrollTop - node.clientHeight <= 24;

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
    if (index > 0 && value - pages[index - 1] > 1) items.push('ellipsis');
    items.push(value);
  });
  return items;
};

type TabType = 'logs' | 'errors';

export function LogsPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const config = useConfigStore((state) => state.config);
  const requestLogEnabled = config?.requestLog ?? false;

  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [hideManagementLogs, setHideManagementLogs] = useLocalStorage(
    'logsPage.hideManagementLogs',
    true
  );
  const [showRawLogs, setShowRawLogs] = useLocalStorage('logsPage.showRawLogs', false);
  const [wrapLogs, setWrapLogs] = useLocalStorage('logsPage.wrapLogs', false);
  const [structuredFiltersExpanded, setStructuredFiltersExpanded] = useState(false);
  const [errorLogs, setErrorLogs] = useState<ErrorLogFile[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [errorLogsError, setErrorLogsError] = useState('');
  const [clearingErrorLogs, setClearingErrorLogs] = useState(false);
  const [errorLogViewer, dispatchErrorLogViewer] = useReducer(errorLogViewerReducer, {
    status: 'closed',
  });
  const selectedErrorLog = errorLogViewer.status === 'closed' ? null : errorLogViewer.item;
  const [viewerRequestId, setViewerRequestId] = useState<string | null>(null);
  const [requestLogDownloading, setRequestLogDownloading] = useState(false);
  const [fullscreenLogs, setFullscreenLogs] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_LOG_PAGE_SIZE);
  const [followLatest, setFollowLatest] = useState(true);
  const logViewerRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const previousPageRef = useRef(1);
  const previousPageSizeRef = useRef(DEFAULT_LOG_PAGE_SIZE);

  const [requests] = useState(() => ({
    session: createLogRequestGuard(),
    errors: createLogRequestGuard(),
    viewer: createLogRequestGuard(),
  }));

  const {
    logBuffer,
    lastUpdated,
    catchingUp,
    wasReset,
    loading,
    clearingLogs,
    error,
    autoRefresh,
    setAutoRefresh,
    cpaNeedsFileLogging,
    showFileLoggingRequired,
    loadLogs,
    clearLogs,
  } = useLogStream({ active: activeTab === 'logs' });

  const disableControls = connectionStatus !== 'connected';
  const refreshDisabled = disableControls || loading || clearingLogs || cpaNeedsFileLogging;
  const autoRefreshDisabled = disableControls || showFileLoggingRequired;
  const clearDisabled = disableControls || clearingLogs || showFileLoggingRequired;

  const downloadLogs = () => {
    const text = logBuffer.buffer.join('\n');
    downloadBlob({ filename: 'logs.txt', blob: new Blob([text], { type: 'text/plain' }) });
    showNotification(t('logs.download_success'), 'success');
  };

  const loadErrorLogs = async () => {
    if (useAuthStore.getState().connectionStatus !== 'connected') {
      setLoadingErrors(false);
      return;
    }
    const request = requests.errors.invalidate();
    setLoadingErrors(true);
    setErrorLogsError('');
    try {
      const res = await logsApi.fetchErrorLogs();
      if (!requests.errors.isCurrent(request)) return;
      // API 返回 { files: [...] }
      setErrorLogs(Array.isArray(res.files) ? res.files : []);
    } catch (err: unknown) {
      if (!requests.errors.isCurrent(request)) return;
      console.error('Failed to load error logs:', err);
      setErrorLogs([]);
      const message = getErrorMessage(err);
      setErrorLogsError(
        message ? `${t('logs.error_logs_load_error')}: ${message}` : t('logs.error_logs_load_error')
      );
    } finally {
      if (requests.errors.isCurrent(request)) setLoadingErrors(false);
    }
  };

  useHeaderRefresh(() => (activeTab === 'errors' ? loadErrorLogs() : loadLogs(false)));
  const clearErrorLogs = () => {
    showConfirmation({
      title: t('logs.error_logs_clear'),
      message: t('logs.error_logs_clear_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        const request = requests.errors.invalidate();
        setClearingErrorLogs(true);
        setErrorLogsError('');
        try {
          await logsApi.clearErrorLogs();
          if (!requests.errors.isCurrent(request)) return;
          setErrorLogs([]);
          showNotification(t('logs.error_logs_clear_success'), 'success');
        } catch (err: unknown) {
          if (!requests.errors.isCurrent(request)) return;
          const message = getErrorMessage(err);
          setErrorLogsError(
            message
              ? `${t('logs.error_logs_clear_failed')}: ${message}`
              : t('logs.error_logs_clear_failed')
          );
        } finally {
          if (requests.errors.isCurrent(request)) setClearingErrorLogs(false);
        }
      },
    });
  };

  const downloadErrorLog = async (name: string) => {
    const session = requests.session.capture();
    try {
      const response = await logsApi.downloadErrorLog(name);
      if (!requests.session.isCurrent(session)) return;
      downloadBlob({ filename: name, blob: new Blob([response.data], { type: 'text/plain' }) });
      showNotification(t('logs.error_log_download_success'), 'success');
    } catch (err: unknown) {
      if (!requests.session.isCurrent(session)) return;
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    }
  };

  const openErrorLog = async (item: ErrorLogFile, byRequestId?: string) => {
    setViewerRequestId(byRequestId ?? null);
    const requestId = requests.viewer.invalidate();
    dispatchErrorLogViewer({ type: 'open', item });

    try {
      if (item.size && item.size > 2 * 1024 * 1024) throw new Error(t('logs.preview_too_large'));
      const response = byRequestId
        ? await logsApi.downloadRequestLogById(byRequestId)
        : await logsApi.downloadErrorLog(item.name);
      if (response.data instanceof Blob && response.data.size > 2 * 1024 * 1024) {
        throw new Error(t('logs.preview_too_large'));
      }
      const text = await responseDataToText(response.data);
      if (!requests.viewer.isCurrent(requestId)) return;
      dispatchErrorLogViewer({ type: 'ready', text });
    } catch (err: unknown) {
      if (!requests.viewer.isCurrent(requestId)) return;
      const message =
        byRequestId &&
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        err.status === 404
          ? `${t('logs.request_log_missing')} ${getErrorMessage(err)}`
          : getErrorMessage(err);
      dispatchErrorLogViewer({
        type: 'error',
        message: message
          ? `${t('logs.error_log_open_failed')}: ${message}`
          : t('logs.error_log_open_failed'),
      });
    }
  };

  const closeErrorLogViewer = () => {
    requests.viewer.invalidate();
    dispatchErrorLogViewer({ type: 'close' });
  };

  const copySelectedErrorLog = async () => {
    if (errorLogViewer.status !== 'ready' || !errorLogViewer.text) return;
    const session = requests.session.capture();
    const ok = await copyToClipboard(errorLogViewer.text);
    if (!requests.session.isCurrent(session)) return;
    showNotification(
      ok
        ? t('logs.error_log_copy_success')
        : t('logs.copy_failed', { defaultValue: 'Copy failed' }),
      ok ? 'success' : 'error'
    );
  };

  useEffect(() => {
    const resetErrors = () => {
      requests.errors.invalidate();
      setErrorLogs([]);
      setLoadingErrors(false);
      setErrorLogsError('');
    };
    const invalidateSession = () => {
      requests.session.invalidate();
      requests.errors.invalidate();
      requests.viewer.invalidate();
    };

    // Store subscriptions invalidate synchronously, before a response can beat effect cleanup.
    const unsubscribeAuth = useAuthStore.subscribe((next, previous) => {
      if (
        next.apiBase === previous.apiBase &&
        next.managementKey === previous.managementKey &&
        next.connectionStatus === previous.connectionStatus &&
        next.isAuthenticated === previous.isAuthenticated
      )
        return;
      invalidateSession();
      resetErrors();
      dispatchErrorLogViewer({ type: 'close' });
      setViewerRequestId(null);
      setRequestLogDownloading(false);
    });
    const unsubscribeConfig = useConfigStore.subscribe((next, previous) => {
      if (next.config?.requestLog !== previous.config?.requestLog) resetErrors();
    });
    return () => {
      unsubscribeAuth();
      unsubscribeConfig();
      invalidateSession();
    };
  }, [requests]);

  useEffect(() => {
    if (activeTab !== 'errors') return;
    if (connectionStatus !== 'connected') return;
    void loadErrorLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, connectionStatus, apiBase, managementKey, requestLogEnabled]);

  const [parseEntries] = useState(createLogParserCache);
  const entries = useMemo(() => parseEntries(logBuffer), [logBuffer, parseEntries]);
  const [levelFilter, setLevelFilter] = useState('');
  const trimmedSearchQuery = deferredSearchQuery.trim();
  const parsedSearchLines = useMemo(
    () => searchLogEntries(entries, trimmedSearchQuery, hideManagementLogs),
    [entries, trimmedSearchQuery, hideManagementLogs]
  );

  const filters = useLogFilters({ parsedLines: parsedSearchLines });
  const structuredFiltersPanelId = 'logs-structured-filters';
  const structuredFilterCount =
    filters.methodFilters.length + filters.statusFilters.length + filters.pathFilters.length;

  const filteredParsedLines = useMemo(
    () =>
      filterLogEntries(parsedSearchLines, {
        methods: filters.methodFilterSet,
        statuses: filters.statusFilterSet,
        paths: filters.pathFilterSet,
        level: levelFilter,
      }),
    [
      parsedSearchLines,
      filters.methodFilterSet,
      filters.statusFilterSet,
      filters.pathFilterSet,
      levelFilter,
    ]
  );
  const filteredLines = useMemo(
    () => filteredParsedLines.map((line) => line.raw),
    [filteredParsedLines]
  );
  const totalPages = Math.max(1, Math.ceil(filteredParsedLines.length / pageSize));
  const currentPage = followLatest ? totalPages : Math.min(Math.max(page, 1), totalPages);
  const pageItems = useMemo(
    () => buildPageItems(currentPage, totalPages),
    [currentPage, totalPages]
  );
  const pageStart = (currentPage - 1) * pageSize;
  const parsedVisibleLines = filteredParsedLines.slice(pageStart, pageStart + pageSize);
  const pendingLines = Math.max(0, filteredParsedLines.length - currentPage * pageSize);

  useEffect(() => {
    followLatestRef.current = true;
    setFollowLatest(true);
  }, [
    trimmedSearchQuery,
    hideManagementLogs,
    levelFilter,
    filters.methodFilterSet,
    filters.statusFilterSet,
    filters.pathFilterSet,
  ]);

  useEffect(() => {
    if (!wasReset) return;
    followLatestRef.current = true;
    setFollowLatest(true);
  }, [wasReset]);

  const requestScrollToBottom = () => {
    window.requestAnimationFrame(() => {
      const node = logViewerRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  };

  const changePage = (nextPage: number) => {
    const clamped = Math.min(Math.max(nextPage, 1), totalPages);
    const atLatest = clamped === totalPages;
    setPage(clamped);
    followLatestRef.current = atLatest;
    setFollowLatest(atLatest);
  };

  const changePageSize = (nextPageSize: number) => {
    const nextTotalPages = Math.max(1, Math.ceil(filteredParsedLines.length / nextPageSize));
    setPage((current) => Math.min(current, nextTotalPages));
    setPageSize(nextPageSize);
  };

  const goToLatest = () => {
    setPage(totalPages);
    followLatestRef.current = true;
    setFollowLatest(true);
    requestScrollToBottom();
  };

  const handleLogScroll = () => {
    const shouldFollow = currentPage === totalPages && isNearBottom(logViewerRef.current);
    if (shouldFollow === followLatestRef.current) return;
    if (!shouldFollow && followLatestRef.current) setPage(currentPage);
    followLatestRef.current = shouldFollow;
    setFollowLatest(shouldFollow);
  };

  useLayoutEffect(() => {
    const node = logViewerRef.current;
    if (!node) return;
    if (followLatest) {
      node.scrollTop = node.scrollHeight;
    } else if (
      previousPageRef.current !== currentPage ||
      previousPageSizeRef.current !== pageSize
    ) {
      node.scrollTop = 0;
    }
    previousPageRef.current = currentPage;
    previousPageSizeRef.current = pageSize;
  }, [
    currentPage,
    followLatest,
    filteredParsedLines.length,
    logBuffer.nextId,
    pageSize,
    showRawLogs,
    wrapLogs,
  ]);

  const copyLogLine = async (raw: string) => {
    const ok = await copyToClipboard(raw);
    if (ok) {
      showNotification(t('logs.copy_success', { defaultValue: 'Copied to clipboard' }), 'success');
    } else {
      showNotification(t('logs.copy_failed', { defaultValue: 'Copy failed' }), 'error');
    }
  };

  const downloadRequestLog = async (id: string) => {
    const session = requests.session.capture();
    setRequestLogDownloading(true);
    try {
      const response = await logsApi.downloadRequestLogById(id);
      if (!requests.session.isCurrent(session)) return;
      downloadBlob({
        filename: `request-${id}.log`,
        blob: new Blob([response.data], { type: 'text/plain' }),
      });
      showNotification(t('logs.request_log_download_success'), 'success');
    } catch (err: unknown) {
      if (!requests.session.isCurrent(session)) return;
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      if (requests.session.isCurrent(session)) setRequestLogDownloading(false);
    }
  };

  useEffect(() => {
    if (!fullscreenLogs) return;

    document.body.classList.add('logs-fullscreen-active');
    lockScroll();

    const handleEscape = (event: KeyboardEvent) => {
      if (!shouldExitLogFullscreen(event, !!document.querySelector('.modal-overlay'))) return;
      setFullscreenLogs(false);
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('logs-fullscreen-active');
      unlockScroll();
    };
  }, [fullscreenLogs]);

  return (
    <div className={styles.container}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>{t('logs.title')}</h1>
          <div className={styles.heroMeta}>
            <span className={styles.heroLive} data-live={autoRefresh && !disableControls}>
              <i aria-hidden="true" />
              {t(autoRefresh ? 'logs.read_status_live' : 'logs.read_status_paused')}
            </span>
            <span>
              {t('logs.buffer_scope', {
                count: logBuffer.buffer.length,
                matched: filteredLines.length,
              })}
            </span>
          </div>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.heroTabs} role="group" aria-label={t('logs.title')}>
            <button
              type="button"
              className={`${styles.heroTab} ${activeTab === 'logs' ? styles.heroTabActive : ''}`}
              aria-pressed={activeTab === 'logs'}
              onClick={() => setActiveTab('logs')}
            >
              {t('logs.log_content')}
            </button>
            <button
              type="button"
              className={`${styles.heroTab} ${activeTab === 'errors' ? styles.heroTabActive : ''}`}
              aria-pressed={activeTab === 'errors'}
              onClick={() => {
                setFullscreenLogs(false);
                setActiveTab('errors');
              }}
            >
              {t('logs.error_logs_modal_title')}
            </button>
          </div>
        </div>
      </header>

      <div className={styles.content}>
        {activeTab === 'logs' && (
          <Card
            className={[styles.logCard, fullscreenLogs ? styles.logCardFullscreen : '']
              .filter(Boolean)
              .join(' ')}
          >
            <div className={styles.consoleChrome}>
              <span className={styles.consoleTitle}>
                {activeTab === 'logs' ? t('logs.log_content') : t('logs.error_logs_modal_title')}
              </span>
              <span className={styles.consoleMode}>
                {t(autoRefresh ? 'logs.read_status_live' : 'logs.read_status_paused')}
              </span>
            </div>
            {showFileLoggingRequired && (
              <div className="status-badge warning">
                {t(
                  cpaNeedsFileLogging
                    ? 'logs.cpa_file_logging_required'
                    : 'logs.file_logging_required'
                )}
              </div>
            )}
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            <footer className={styles.statusBar}>
              <div
                className={styles.readStatus}
                role="status"
                data-live={autoRefresh && !disableControls}
              >
                <span className={styles.statusDot} aria-hidden="true" />
                {t(
                  catchingUp && autoRefresh
                    ? 'logs.read_status_catching_up'
                    : autoRefresh
                      ? 'logs.read_status_live'
                      : 'logs.read_status_paused'
                )}
                {lastUpdated && (
                  <>
                    {' '}
                    · {t('logs.last_updated', { time: new Date(lastUpdated).toLocaleTimeString() })}
                  </>
                )}
              </div>
              <div className={styles.bufferStatus}>
                {t('logs.buffer_scope', {
                  count: logBuffer.buffer.length,
                  matched: filteredLines.length,
                })}
              </div>
            </footer>
            <div className={styles.notices}>
              {wasReset && (
                <div className="hint" role="status">
                  {t('logs.cursor_reset_notice')}
                </div>
              )}
            </div>
            {!followLatest && (
              <Button
                className={styles.followButton}
                variant="secondary"
                size="sm"
                onClick={goToLatest}
              >
                {pendingLines > 0
                  ? t('logs.resume_following', { count: pendingLines })
                  : t('logs.back_to_latest')}
              </Button>
            )}

            <div className={styles.filters}>
              <div className={styles.searchWrapper}>
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('logs.search_placeholder')}
                  aria-label={t('logs.search_placeholder')}
                  className={styles.searchInput}
                  rightElement={
                    searchQuery ? (
                      <button
                        type="button"
                        className={styles.searchClear}
                        onClick={() => setSearchQuery('')}
                        title={t('logs.clear_search')}
                        aria-label={t('logs.clear_search')}
                      >
                        <IconX size={16} />
                      </button>
                    ) : (
                      <IconSearch size={16} className={styles.searchIcon} />
                    )
                  }
                />
              </div>

              <Select
                className={styles.levelSelect}
                fullWidth={false}
                value={levelFilter}
                onChange={setLevelFilter}
                ariaLabel={t('logs.level_filter')}
                options={[
                  { value: '', label: t('logs.all_levels') },
                  ...['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => ({
                    value: level,
                    label: level.toUpperCase(),
                  })),
                ]}
              />
              <div className={styles.filterPanelHeader}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={styles.filterPanelToggle}
                  onClick={() => setStructuredFiltersExpanded((prev) => !prev)}
                  aria-haspopup="dialog"
                  aria-label={t('logs.filter_panel_title')}
                  title={t('logs.filter_panel_title')}
                >
                  <span className={styles.filterPanelButtonContent}>
                    <IconSlidersHorizontal size={16} />
                    <span className={styles.filterPanelLabel}>{t('logs.filter_panel_title')}</span>
                    {structuredFilterCount > 0 && (
                      <span className={styles.filterPanelCount}>
                        {t('logs.filter_panel_active_count', { count: structuredFilterCount })}
                      </span>
                    )}
                  </span>
                </Button>
              </div>

              <Modal
                open={structuredFiltersExpanded}
                onClose={() => setStructuredFiltersExpanded(false)}
                title={t('logs.filter_panel_title')}
                width={640}
                footer={
                  <Button variant="secondary" onClick={() => setStructuredFiltersExpanded(false)}>
                    {t('common.close')}
                  </Button>
                }
              >
                <div id={structuredFiltersPanelId} className={styles.structuredFilters}>
                  <div className={styles.filterChipGroup}>
                    <span className={styles.filterChipLabel}>{t('logs.filter_method')}</span>
                    <div className={styles.filterChipList}>
                      {HTTP_METHODS.map((method) => {
                        const active = filters.methodFilters.includes(method);
                        const count = filters.methodCounts[method] ?? 0;
                        return (
                          <button
                            key={method}
                            type="button"
                            className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
                            onClick={() => filters.toggleMethodFilter(method)}
                            disabled={count === 0 && !active}
                            aria-pressed={active}
                          >
                            {method} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.filterChipGroup}>
                    <span className={styles.filterChipLabel}>{t('logs.filter_status')}</span>
                    <div className={styles.filterChipList}>
                      {STATUS_GROUPS.map((statusGroup) => {
                        const active = filters.statusFilters.includes(statusGroup);
                        const count = filters.statusCounts[statusGroup] ?? 0;
                        return (
                          <button
                            key={statusGroup}
                            type="button"
                            className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
                            onClick={() => filters.toggleStatusFilter(statusGroup)}
                            disabled={count === 0 && !active}
                            aria-pressed={active}
                          >
                            {t(`logs.filter_status_${statusGroup}`)} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.filterChipGroup}>
                    <span className={styles.filterChipLabel}>{t('logs.filter_path')}</span>
                    <div className={styles.filterChipList}>
                      {filters.pathOptions.length === 0 ? (
                        <span className={styles.filterChipHint}>{t('logs.filter_path_empty')}</span>
                      ) : (
                        filters.pathOptions.map(({ path, count }) => {
                          const active = filters.pathFilters.includes(path);
                          return (
                            <button
                              key={path}
                              type="button"
                              className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
                              onClick={() => filters.togglePathFilter(path)}
                              aria-pressed={active}
                              title={path}
                            >
                              {path} ({count})
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={filters.clearStructuredFilters}
                    disabled={!filters.hasStructuredFilters}
                  >
                    {t('logs.clear_filters')}
                  </Button>
                </div>

                <div className={styles.displayOptions}>
                  <ToggleSwitch
                    checked={wrapLogs}
                    onChange={setWrapLogs}
                    label={t('logs.wrap_lines')}
                  />
                  <ToggleSwitch
                    checked={hideManagementLogs}
                    onChange={setHideManagementLogs}
                    label={
                      <span className={styles.switchLabel}>
                        <IconEyeOff size={16} />
                        {t('logs.hide_management_logs', { prefix: MANAGEMENT_API_PREFIX })}
                      </span>
                    }
                  />

                  <ToggleSwitch
                    checked={showRawLogs}
                    onChange={setShowRawLogs}
                    label={
                      <span
                        className={styles.switchLabel}
                        title={t('logs.show_raw_logs_hint', {
                          defaultValue: 'Show original log text for easier multi-line copy',
                        })}
                      >
                        <IconCode size={16} />
                        {t('logs.show_raw_logs', { defaultValue: 'Show raw logs' })}
                      </span>
                    }
                  />
                </div>
              </Modal>

              <div className={styles.toolbar}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => loadLogs(false)}
                  disabled={refreshDisabled}
                  className={styles.actionButton}
                  title={t('logs.refresh_button')}
                  aria-label={t('logs.refresh_button')}
                >
                  <IconRefreshCw size={16} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.actionButton}
                  aria-pressed={autoRefresh}
                  aria-label={t('logs.reading_enabled')}
                  title={t('logs.reading_enabled')}
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  disabled={autoRefreshDisabled}
                >
                  <IconTimer size={16} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={downloadLogs}
                  disabled={logBuffer.buffer.length === 0}
                  className={styles.actionButton}
                  title={t('logs.download_cached')}
                  aria-label={t('logs.download_cached')}
                >
                  <IconDownload size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearLogs}
                  disabled={clearDisabled}
                  className={styles.actionButton}
                  title={t('logs.clear_button')}
                  aria-label={t('logs.clear_button')}
                >
                  <IconTrash2 size={16} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFullscreenLogs((prev) => !prev)}
                  className={styles.actionButton}
                  aria-pressed={fullscreenLogs}
                  aria-label={
                    fullscreenLogs ? t('logs.exit_fullscreen_button') : t('logs.fullscreen_button')
                  }
                  title={
                    fullscreenLogs ? t('logs.exit_fullscreen_button') : t('logs.fullscreen_button')
                  }
                >
                  <span className={styles.buttonContent}>
                    {fullscreenLogs ? <IconMinimize2 size={16} /> : <IconMaximize2 size={16} />}
                  </span>
                </Button>
              </div>
            </div>

            <div className={styles.viewerArea}>
              {loading && logBuffer.buffer.length === 0 ? (
                <div className="hint">{t('logs.loading')}</div>
              ) : logBuffer.buffer.length > 0 && filteredLines.length > 0 ? (
                <div
                  ref={logViewerRef}
                  className={[
                    styles.logPanel,
                    wrapLogs ? styles.wrapped : '',
                    fullscreenLogs ? styles.logPanelFullscreen : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onScroll={handleLogScroll}
                  tabIndex={0}
                  role="region"
                  aria-label={t('logs.log_content')}
                  aria-busy={loading}
                >
                  {showRawLogs ? (
                    <pre className={styles.rawLog} spellCheck={false}>
                      {parsedVisibleLines.map((line) => (
                        <span key={line.id} data-log-id={line.id} style={{ display: 'block' }}>
                          {line.raw || '\u00a0'}
                        </span>
                      ))}
                    </pre>
                  ) : (
                    <div className={styles.logList}>
                      {parsedVisibleLines.map((line) => {
                        const rowClassNames = [styles.logRow];
                        if (line.level === 'warn') rowClassNames.push(styles.rowWarn);
                        if (line.level === 'error' || line.level === 'fatal')
                          rowClassNames.push(styles.rowError);
                        return (
                          <div
                            key={line.id}
                            data-log-id={line.id}
                            className={rowClassNames.join(' ')}
                            onDoubleClick={() => {
                              void copyLogLine(line.raw);
                            }}
                            title={t('logs.double_click_copy_hint', {
                              defaultValue: 'Double-click to copy',
                            })}
                          >
                            <div className={styles.timestamp}>{line.timestamp || ''}</div>
                            <div className={styles.rowMain}>
                              {line.level && (
                                <span
                                  className={[
                                    styles.badge,
                                    line.level === 'info' ? styles.levelInfo : '',
                                    line.level === 'warn' ? styles.levelWarn : '',
                                    line.level === 'error' || line.level === 'fatal'
                                      ? styles.levelError
                                      : '',
                                    line.level === 'debug' ? styles.levelDebug : '',
                                    line.level === 'trace' ? styles.levelTrace : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {line.level.toUpperCase()}
                                </span>
                              )}

                              {line.source && (
                                <span className={styles.source} title={line.source}>
                                  {line.source}
                                </span>
                              )}

                              {line.requestId && (
                                <button
                                  type="button"
                                  className={[styles.badge, styles.requestIdBadge].join(' ')}
                                  title={t('logs.view_request', { id: line.requestId })}
                                  aria-label={t('logs.view_request', { id: line.requestId })}
                                  onClick={() =>
                                    void openErrorLog(
                                      { name: `request-${line.requestId}.log` },
                                      line.requestId
                                    )
                                  }
                                >
                                  {line.requestId}
                                </button>
                              )}

                              {typeof line.statusCode === 'number' && (
                                <span
                                  className={[
                                    styles.badge,
                                    styles.statusBadge,
                                    line.statusCode >= 200 && line.statusCode < 300
                                      ? styles.statusSuccess
                                      : line.statusCode >= 300 && line.statusCode < 400
                                        ? styles.statusInfo
                                        : line.statusCode >= 400 && line.statusCode < 500
                                          ? styles.statusWarn
                                          : styles.statusError,
                                  ].join(' ')}
                                >
                                  {line.statusCode}
                                </span>
                              )}

                              {line.latency && <span className={styles.pill}>{line.latency}</span>}
                              {line.ip && <span className={styles.pill}>{line.ip}</span>}

                              {line.method && (
                                <span className={[styles.badge, styles.methodBadge].join(' ')}>
                                  {line.method}
                                </span>
                              )}

                              {line.path && (
                                <span className={styles.path} title={line.path}>
                                  {line.path}
                                </span>
                              )}

                              {line.message && (
                                <span className={styles.message}>{line.message}</span>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className={styles.copyButton}
                                title={t('logs.copy_line')}
                                onClick={() => void copyLogLine(line.raw)}
                                aria-label={t('logs.copy_line')}
                              >
                                <IconCopy size={14} />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : logBuffer.buffer.length > 0 ? (
                <EmptyState
                  title={t('logs.search_empty_title')}
                  description={t('logs.search_empty_desc')}
                />
              ) : showFileLoggingRequired ? (
                <EmptyState
                  title={t(
                    cpaNeedsFileLogging
                      ? 'logs.cpa_file_logging_required_title'
                      : 'logs.file_logging_required_title'
                  )}
                  description={t(
                    cpaNeedsFileLogging
                      ? 'logs.cpa_file_logging_required_desc'
                      : 'logs.file_logging_required_desc'
                  )}
                />
              ) : (
                <EmptyState title={t('logs.empty_title')} description={t('logs.empty_desc')} />
              )}
              {logBuffer.buffer.length > 0 && filteredLines.length > 0 && (
                <nav className={styles.pagination} aria-label={t('logs.pagination_aria')}>
                  <div className={styles.pageButtons}>
                    <button
                      type="button"
                      className={styles.pageButton}
                      onClick={() => changePage(currentPage - 1)}
                      disabled={currentPage <= 1}
                    >
                      {t('logs.page_prev')}
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
                          className={[
                            styles.pageButton,
                            item === currentPage ? styles.pageButtonActive : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-current={item === currentPage ? 'page' : undefined}
                          onClick={() => changePage(item)}
                        >
                          {item}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      className={styles.pageButton}
                      onClick={() => changePage(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                    >
                      {t('logs.page_next')}
                    </button>
                  </div>
                  <span className={styles.pageMeta}>
                    {t('logs.page_info', {
                      page: currentPage,
                      total: totalPages,
                      count: filteredLines.length,
                    })}
                  </span>
                  <label className={styles.pageSize}>
                    <span>{t('logs.page_size')}</span>
                    <select
                      value={pageSize}
                      onChange={(event) => changePageSize(Number(event.target.value))}
                    >
                      {LOG_PAGE_SIZE_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </nav>
              )}
            </div>
          </Card>
        )}

        {activeTab === 'errors' && (
          <Card
            className={styles.errorCard}
            title={t('logs.error_logs_modal_title')}
            extra={
              <div className={styles.errorLogActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadErrorLogs}
                  loading={loadingErrors}
                  disabled={disableControls || clearingErrorLogs}
                >
                  {t('common.refresh')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={clearErrorLogs}
                  loading={clearingErrorLogs}
                  disabled={disableControls || loadingErrors || errorLogs.length === 0}
                >
                  {t('logs.error_logs_clear')}
                </Button>
              </div>
            }
          >
            <div className={styles.errorBody}>
              <div className="hint">{t('logs.error_logs_description')}</div>

              {requestLogEnabled && (
                <div>
                  <div className="status-badge warning">
                    {t('logs.error_logs_request_log_enabled')}
                  </div>
                </div>
              )}

              {errorLogsError && <div className="error-box">{errorLogsError}</div>}

              <div className={styles.errorPanel}>
                {loadingErrors ? (
                  <div className="hint">{t('common.loading')}</div>
                ) : errorLogs.length === 0 ? (
                  <div className="hint">{t('logs.error_logs_empty')}</div>
                ) : (
                  <div className="item-list">
                    {errorLogs.map((item) => (
                      <div key={item.name} className="item-row">
                        <div className="item-meta">
                          <div className="item-title">{item.name}</div>
                          <div className="item-subtitle">
                            {item.size ? `${(item.size / 1024).toFixed(1)} KB` : ''}{' '}
                            {item.modified ? formatUnixTimestamp(item.modified) : ''}
                          </div>
                        </div>
                        <div className="item-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              void openErrorLog(item);
                            }}
                            disabled={disableControls}
                          >
                            <span className={styles.buttonContent}>
                              <IconEye size={16} />
                              {t('logs.error_logs_open')}
                            </span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => downloadErrorLog(item.name)}
                            disabled={disableControls}
                          >
                            {t('logs.error_logs_download')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      <Modal
        open={errorLogViewer.status !== 'closed'}
        onClose={closeErrorLogViewer}
        title={selectedErrorLog?.name ?? t('logs.error_log_view_title')}
        width={960}
        footer={
          <>
            <Button variant="secondary" onClick={closeErrorLogViewer}>
              {t('common.close')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void copySelectedErrorLog();
              }}
              disabled={errorLogViewer.status !== 'ready' || !errorLogViewer.text}
            >
              {t('common.copy')}
            </Button>
            <Button
              onClick={() => {
                if (viewerRequestId) void downloadRequestLog(viewerRequestId);
                else if (selectedErrorLog) void downloadErrorLog(selectedErrorLog.name);
              }}
              loading={requestLogDownloading}
              disabled={errorLogViewer.status === 'closed' || errorLogViewer.status === 'loading'}
            >
              {t('logs.error_logs_download')}
            </Button>
          </>
        }
      >
        <div className={styles.errorLogViewer}>
          {selectedErrorLog && (
            <div className={styles.errorLogViewerMeta}>
              <span>
                {t('logs.error_logs_size')}:{' '}
                {selectedErrorLog.size ? `${(selectedErrorLog.size / 1024).toFixed(1)} KB` : '-'}
              </span>
              <span>
                {t('logs.error_logs_modified')}:{' '}
                {selectedErrorLog.modified ? formatUnixTimestamp(selectedErrorLog.modified) : '-'}
              </span>
            </div>
          )}
          {errorLogViewer.status === 'error' && (
            <div className="error-box">{errorLogViewer.message}</div>
          )}
          {errorLogViewer.status === 'loading' && <div className="hint">{t('common.loading')}</div>}
          {errorLogViewer.status === 'ready' &&
            (errorLogViewer.text ? (
              <pre className={styles.errorLogContent} spellCheck={false}>
                {errorLogViewer.text}
              </pre>
            ) : (
              <div className="hint">{t('logs.error_log_empty_content')}</div>
            ))}
        </div>
      </Modal>
    </div>
  );
}

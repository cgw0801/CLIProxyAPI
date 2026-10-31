import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useNotificationStore, useModelsStore, useThemeStore } from '@/stores';
import {
  versionApi,
  type ServerUpdateStatus,
  type ServerVersionInfo,
} from '@/services/api/version';
import { classifyModels } from '@/utils/models';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconMeta from '@/assets/icons/meta.svg';
import iconDevinLight from '@/assets/icons/devin.svg';
import iconDevinDark from '@/assets/icons/devin-dark.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import styles from './SystemPage.module.scss';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  devin: { light: iconDevinLight, dark: iconDevinDark },
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  meta: iconMeta,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiDark, dark: iconKimiLight },
  glm: iconGlm,
  grok: { light: iconGrok, dark: iconGrokDark },
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

const normalizeVersion = (value: string): string => value.trim().replace(/^[vV]+/, '');

const waitForVersion = async (
  expected: string,
  attempts = 30
): Promise<ServerVersionInfo | null> => {
  const target = normalizeVersion(expected);
  if (!target) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    try {
      const info = await versionApi.getVersion();
      if (normalizeVersion(info.version) === target) return info;
    } catch {
      // The server is restarting and may refuse connections for a moment.
    }
  }
  return null;
};

const waitForServerRestart = async (
  previousStartedAt: string | undefined,
  attempts = 30
): Promise<ServerVersionInfo | null> => {
  await new Promise((resolve) => window.setTimeout(resolve, 2000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const info = await versionApi.getVersion();
      if (!previousStartedAt || (info.started_at && info.started_at !== previousStartedAt)) {
        return info;
      }
    } catch {
      // The service is still restarting; retry after the next interval.
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  }
  return null;
};

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const auth = useAuthStore();
  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchManagementModels = useModelsStore((state) => state.fetchManagementModels);

  const [modelStatus, setModelStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  }>();
  const [versionInfo, setVersionInfo] = useState<ServerVersionInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<ServerUpdateStatus | null>(null);
  const [versionMessage, setVersionMessage] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);
  const currentVersion = versionInfo?.version || auth.serverVersion || '';
  const displayVersion = currentVersion
    ? `v${normalizeVersion(currentVersion)}`
    : t('system_info.version_unknown');

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required'),
      });
      return;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const list = await fetchManagementModels(forceRefresh);
      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels
          ? t('system_info.models_count', { count: list.length })
          : t('system_info.models_empty'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const suffix = message ? `: ${message}` : '';
      setModelStatus({ type: 'error', message: `${t('system_info.models_error')}${suffix}` });
    }
  };

  const checkForUpdates = async () => {
    if (checkingUpdate || restarting || updating) return;
    if (auth.connectionStatus !== 'connected') {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }
    setCheckingUpdate(true);
    setVersionMessage(null);
    try {
      const status = await versionApi.checkUpdate();
      setUpdateStatus(status);
      if (status.current_version) {
        setVersionInfo((current) =>
          current
            ? { ...current, version: status.current_version }
            : {
                version: status.current_version,
                commit: '',
                build_date: '',
                repository: '',
              }
        );
      }
      if (status.update_available) {
        setVersionMessage({
          type: 'warning',
          message: t('system_info.version_update_available', { version: status.latest_version }),
        });
      } else {
        setVersionMessage({ type: 'success', message: t('system_info.version_is_latest') });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const suffix = message ? `: ${message}` : '';
      setUpdateStatus(null);
      setVersionMessage({
        type: 'error',
        message: `${t('system_info.version_check_error')}${suffix}`,
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const applyUpdate = async () => {
    if (!updateStatus?.update_available || updating || restarting) return;
    const expected = updateStatus.latest_version;
    setUpdating(true);
    setVersionMessage({
      type: 'muted',
      message: t('system_info.version_updating', { version: expected }),
    });
    try {
      const result = await versionApi.applyUpdate();
      const target = result.version || expected;
      const info = await waitForVersion(target);
      if (info) {
        setVersionInfo(info);
        setUpdateStatus(null);
        setVersionMessage({
          type: 'success',
          message: t('system_info.version_update_success', { version: info.version }),
        });
        window.setTimeout(() => window.location.reload(), 1200);
      } else {
        setVersionMessage({
          type: 'warning',
          message: t('system_info.version_restart_pending', { version: target }),
        });
      }
    } catch (err: unknown) {
      const info = await waitForVersion(expected);
      if (info) {
        setVersionInfo(info);
        setUpdateStatus(null);
        setVersionMessage({
          type: 'success',
          message: t('system_info.version_update_success', { version: info.version }),
        });
        window.setTimeout(() => window.location.reload(), 1200);
      } else {
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
        const suffix = message ? `: ${message}` : '';
        setVersionMessage({
          type: 'error',
          message: `${t('system_info.version_update_error')}${suffix}`,
        });
      }
    } finally {
      setUpdating(false);
    }
  };

  const restartServer = async () => {
    if (restarting || updating) return;
    setRestarting(true);
    setVersionMessage({
      type: 'muted',
      message: t('system_info.version_restarting'),
    });
    try {
      let previousStartedAt = versionInfo?.started_at;
      if (!previousStartedAt) {
        try {
          previousStartedAt = (await versionApi.getVersion()).started_at;
        } catch {
          // The restart response below still surfaces connection failures.
        }
      }
      await versionApi.restartServer();
      const info = await waitForServerRestart(previousStartedAt);
      if (!info) {
        const message = t('system_info.version_restart_error');
        setVersionMessage({ type: 'error', message });
        showNotification(message, 'error');
        return;
      }
      setVersionInfo(info);
      setUpdateStatus(null);
      setVersionMessage({
        type: 'success',
        message: t('system_info.version_restart_success'),
      });
      showNotification(t('system_info.version_restart_success'), 'success');
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const suffix = detail ? `: ${detail}` : '';
      const message = `${t('system_info.version_restart_error')}${suffix}`;
      setVersionMessage({ type: 'error', message });
      showNotification(message, 'error');
    } finally {
      setRestarting(false);
    }
  };

  const confirmRestart = () => {
    if (restarting || updating) return;
    showConfirmation({
      title: t('system_info.version_restart_confirm_title'),
      message: t('system_info.version_restart_confirm_message'),
      confirmText: t('system_info.version_restart_confirm_button'),
      variant: 'danger',
      onConfirm: restartServer,
    });
  };

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.connectionStatus, auth.apiBase]);

  useEffect(() => {
    if (auth.connectionStatus !== 'connected') return;
    let active = true;
    versionApi
      .getVersion()
      .then((info) => {
        if (active) setVersionInfo(info);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [auth.connectionStatus, auth.apiBase]);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <h1>{t('system_info.title')}</h1>
          <p>{t('system_info.about_title')}</p>
        </div>
        <div className={styles.heroStatus}>
          <span
            className={`${styles.statusDot} ${
              auth.connectionStatus === 'connected' ? styles.statusDotLive : ''
            }`}
            aria-hidden="true"
          />
          <span>{t(`common.${auth.connectionStatus}_status`)}</span>
          <span className={styles.heroStatusMeta}>{auth.apiBase || '-'}</span>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>{t('system_info.version_title')}</h2>
            <p>{t('system_info.version_desc')}</p>
          </div>
          <div className={styles.sectionHeaderActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={confirmRestart}
              loading={restarting}
              disabled={updating}
            >
              {t('system_info.version_restart_button')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={checkForUpdates}
              loading={checkingUpdate}
              disabled={restarting || updating}
            >
              {t('system_info.version_check_button')}
            </Button>
          </div>
        </div>
        <div className={styles.versionCard}>
          <div className={styles.versionPrimary}>
            <span className={styles.versionLabel}>{t('system_info.version_current')}</span>
            <strong className={styles.versionNumber}>{displayVersion}</strong>
          </div>
          <div className={styles.versionDetails}>
            {versionMessage ? (
              <div className={`status-badge ${versionMessage.type}`}>{versionMessage.message}</div>
            ) : (
              <span className={styles.versionHint}>{t('system_info.version_hint')}</span>
            )}
            {updateStatus?.update_available ? (
              <div className={styles.versionActions}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={applyUpdate}
                  loading={updating}
                  disabled={!updateStatus.can_update || restarting}
                >
                  {t('system_info.version_update_button')}
                </Button>
                {!updateStatus.can_update ? (
                  <span className={styles.versionHint}>{t('system_info.version_manual')}</span>
                ) : null}
                {updateStatus.release_url ? (
                  <a
                    className={styles.versionLink}
                    href={updateStatus.release_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('system_info.version_release_notes')}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>{t('system_info.models_title')}</h2>
            <p>{t('system_info.models_desc')}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchModels({ forceRefresh: true })}
            loading={modelsLoading}
          >
            {t('common.refresh')}
          </Button>
        </div>
        <div className={styles.modelStatusRow}>
          {modelStatus && (
            <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>
          )}
          {modelsError && <div className="error-box">{modelsError}</div>}
        </div>
        {modelsLoading ? (
          <div className={styles.modelPlaceholder}>{t('common.loading')}</div>
        ) : models.length === 0 ? (
          <div className={styles.modelPlaceholder}>{t('system_info.models_empty')}</div>
        ) : (
          <div className={styles.modelGrid}>
            {groupedModels.map((group) => {
              const iconSrc = getIconForCategory(group.id);
              return (
                <article key={group.id} className={styles.modelGroup}>
                  <header className={styles.modelGroupHeader}>
                    {iconSrc && <img src={iconSrc} alt="" className={styles.groupIcon} />}
                    <div className={styles.groupTitle}>
                      <strong>{group.label}</strong>
                      <span>{t('system_info.models_count', { count: group.items.length })}</span>
                    </div>
                  </header>
                  <div className={styles.modelTags}>
                    {group.items.map((model) => (
                      <span
                        key={`${model.name}-${model.alias ?? 'default'}`}
                        className={styles.modelTag}
                        title={model.description || ''}
                      >
                        <span className={styles.modelName}>{model.name}</span>
                        {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

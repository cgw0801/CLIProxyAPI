import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { useAuthStore, useLanguageStore, useThemeStore } from '@/stores';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import type { ApiError } from '@/types';
import { LegacyBackendError } from '@/services/api/legacyBackendProbe';
import styles from './LoginPage.module.scss';

type RedirectState = { from?: { pathname?: string } };

function getLocalizedErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof LegacyBackendError) return t('login.error_legacy_backend');
  const apiError = error as Partial<ApiError>;
  const status = typeof apiError.status === 'number' ? apiError.status : undefined;
  const code = typeof apiError.code === 'string' ? apiError.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof apiError.message === 'string'
        ? apiError.message
        : typeof error === 'string'
          ? error
          : '';

  const withHttpStatus = (summary: string) => {
    if (!status) return summary;
    const genericAxiosMessage = `Request failed with status code ${status}`;
    const detail = message.trim();
    const backendDetail =
      detail && detail !== genericAxiosMessage
        ? ` (${t('login.error_backend_detail')}: ${detail})`
        : '';
    return `HTTP ${status}: ${summary}${backendDetail}`;
  };

  if (status === 401) return withHttpStatus(t('login.error_unauthorized'));
  if (status === 403) return withHttpStatus(t('login.error_forbidden'));
  if (status === 404) return withHttpStatus(t('login.error_not_found'));
  if (status && status >= 500) return withHttpStatus(t('login.error_server'));
  if (code === 'ECONNABORTED' || message.toLowerCase().includes('timeout')) return t('login.error_timeout');
  if (code === 'ERR_NETWORK' || message.toLowerCase().includes('network error')) return t('login.error_network');
  if (code === 'ERR_CERT_AUTHORITY_INVALID' || message.toLowerCase().includes('certificate')) return t('login.error_ssl');
  if (message.toLowerCase().includes('cors') || message.toLowerCase().includes('cross-origin')) return t('login.error_cors');
  return withHttpStatus(t('login.error_invalid'));
}

const IconSun = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
  </svg>
);

const IconMoon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
  </svg>
);

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M16.5 8a6 6 0 1 0 0 8" />
        <path d="M7 12h7" />
      </svg>
    </span>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const storedApiBase = useAuthStore((state) => state.apiBase);
  const storedManagementKey = useAuthStore((state) => state.managementKey);
  const storedRememberPassword = useAuthStore((state) => state.rememberPassword);
  const login = useAuthStore((state) => state.login);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const detectedBase = useMemo(() => detectApiBaseFromLocation(), []);
  const apiBase = useMemo(() => storedApiBase || detectedBase, [storedApiBase, detectedBase]);
  const [managementKey, setManagementKey] = useState(storedManagementKey);
  const [rememberPassword, setRememberPassword] = useState(storedRememberPassword);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSplash, setShowSplash] = useState(true);
  const [autoLoginSuccess, setAutoLoginSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((success) => {
        if (active) setAutoLoginSuccess(success);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setShowSplash(false);
      });
    return () => {
      active = false;
    };
  }, [restoreSession]);

  const redirectPath = (location.state as RedirectState | null)?.from?.pathname || '/dashboard';

  const handleSubmit = useCallback(async () => {
    const nextBase = normalizeApiBase(apiBase);
    const nextKey = managementKey.trim();
    if (!nextBase || !nextKey) {
      setError(t('login.error_required'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login({ apiBase: nextBase, managementKey: nextKey, rememberPassword });
      navigate(redirectPath, { replace: true });
    } catch (submitError) {
      setError(getLocalizedErrorMessage(submitError, t));
    } finally {
      setLoading(false);
    }
  }, [apiBase, login, managementKey, navigate, redirectPath, rememberPassword, t]);

  const handleSubmitKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  if (isAuthenticated) return <Navigate to={redirectPath} replace />;

  return (
    <div className={styles.screen}>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label={t('theme.switch')}
          title={t('theme.switch')}
        >
          {resolvedTheme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
        <select
          className={styles.languagePicker}
          value={language}
          onChange={(event) => {
            if (isSupportedLanguage(event.target.value)) setLanguage(event.target.value);
          }}
          aria-label={t('language.switch')}
        >
          {LANGUAGE_ORDER.map((lang) => (
            <option key={lang} value={lang}>{t(LANGUAGE_LABEL_KEYS[lang])}</option>
          ))}
        </select>
      </div>

      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.brandBlock}>
            <BrandMark />
            <div className={styles.brandCopy}>
              <strong>CLI Proxy</strong>
              <span>Management console</span>
            </div>
          </div>

          {showSplash ? (
            <div className={styles.splash}>
              <h1>{autoLoginSuccess ? t('common.connected_status') : t('splash.title')}</h1>
              <p>{t('splash.subtitle')}</p>
              <div className={styles.loader}><span /></div>
            </div>
          ) : (
            <>
              <div className={styles.formIntro}>
                <h1>{t('login.submit_button')}</h1>
                <p>{t('login.subtitle')}</p>
              </div>


              <label className={styles.field}>
                <span>{t('login.management_key_label')}</span>
                <div className={styles.secretInput}>
                  <input
                    autoFocus
                    type={showKey ? 'text' : 'password'}
                    name="cpa-management-key"
                    autoComplete="current-password"
                    value={managementKey}
                    placeholder={t('login.management_key_placeholder')}
                    onChange={(event) => setManagementKey(event.target.value)}
                    onKeyDown={handleSubmitKeyDown}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? t('login.hide_key', { defaultValue: 'Hide key' }) : t('login.show_key', { defaultValue: 'Show key' })}
                  >
                    {showKey ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                  </button>
                </div>
              </label>

              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(event) => setRememberPassword(event.target.checked)}
                />
                <span className={styles.checkmark} />
                <span>{t('login.remember_password_label')}</span>
              </label>

              <button type="button" className={styles.submitButton} onClick={() => void handleSubmit()} disabled={loading}>
                <span>{loading ? t('login.submitting') : t('login.submit_button')}</span>
              </button>

              {error ? <div className={styles.errorBox}>{error}</div> : null}

              <p className={styles.finePrint}>Management API v8 · Local deployment</p>
            </>
          )}
        </div>
      </main>

      <footer className={styles.footer}>CLI Proxy API</footer>
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainRoutes } from '@/router/MainRoutes';
import { useAuthStore, useConfigStore, useLanguageStore, useThemeStore } from '@/stores';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';

interface NavItem {
  path: string;
  labelKey: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', labelKey: 'nav.dashboard' },
  { path: '/api-keys', labelKey: 'nav.api_keys' },
  { path: '/ai-providers', labelKey: 'nav.ai_providers' },
  { path: '/oauth', labelKey: 'nav.oauth' },
  { path: '/auth-files', labelKey: 'nav.auth_files' },
  { path: '/quota', labelKey: 'nav.quota_management' },
  { path: '/config', labelKey: 'nav.config_management' },
  { path: '/logs', labelKey: 'nav.logs' },
  { path: '/monitoring', labelKey: 'nav.monitoring' },
  { path: '/system', labelKey: 'nav.system_info' },
];

const IconSun = ({ size = 17 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
  </svg>
);

const IconMoon = ({ size = 17 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
  </svg>
);

const IconRefresh = ({ size = 17 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

const IconLogout = ({ size = 17 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const IconMenu = ({ size = 19 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  >
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

const IconClose = ({ size = 19 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  >
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

function BrandMark() {
  return (
    <span className="app-brand-mark" aria-hidden="true">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      >
        <path d="M16.5 8a6 6 0 1 0 0 8" />
        <path d="M7 12h7" />
      </svg>
    </span>
  );
}

export function MainLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const [navOpen, setNavOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    fetchConfig().catch(() => undefined);
  }, [fetchConfig]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await triggerHeaderRefresh();
    } finally {
      window.setTimeout(() => setRefreshing(false), 320);
    }
  }, []);

  const handleThemeToggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  const statusLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );

  const navLinks = NAV_ITEMS.map((item) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) => 'app-nav-link' + (isActive ? ' is-active' : '')}
    >
      {t(item.labelKey)}
    </NavLink>
  ));

  const mobileNavLinks = NAV_ITEMS.map((item) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) => 'app-mobile-link' + (isActive ? ' is-active' : '')}
      onClick={() => setNavOpen(false)}
    >
      {t(item.labelKey)}
    </NavLink>
  ));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <NavLink to="/" className="app-brand" aria-label="CLI Proxy API">
            <BrandMark />
            <span className="app-brand-copy">
              <span className="app-brand-name">CLI Proxy</span>
              <span className="app-brand-sub">API Console</span>
            </span>
          </NavLink>

          <nav className="app-nav" aria-label={t('sidebar.subtitle')}>
            {navLinks}
          </nav>

          <div className="app-header-actions">
            <span className="app-connection" title={statusLabel}>
              <span
                className={'app-status-dot' + (connectionStatus === 'connected' ? ' is-live' : '')}
                aria-hidden="true"
              />
              <span className="app-connection-label">{statusLabel}</span>
            </span>
            <button
              type="button"
              className={'app-icon-button' + (refreshing ? ' is-spinning' : '')}
              onClick={() => void handleRefresh()}
              title={t('header.refresh_all')}
              aria-label={t('header.refresh_all')}
            >
              <IconRefresh />
            </button>
            <button
              type="button"
              className="app-icon-button"
              onClick={handleThemeToggle}
              title={t('theme.switch')}
              aria-label={t('theme.switch')}
            >
              {resolvedTheme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
            <label className="app-language" title={t('language.switch')}>
              <select
                value={language}
                onChange={(event) => {
                  if (isSupportedLanguage(event.target.value)) setLanguage(event.target.value);
                }}
                aria-label={t('language.switch')}
              >
                {LANGUAGE_ORDER.map((lang) => (
                  <option key={lang} value={lang}>
                    {t(LANGUAGE_LABEL_KEYS[lang])}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="app-icon-button app-logout"
              onClick={logout}
              title={t('header.logout')}
              aria-label={t('header.logout')}
            >
              <IconLogout />
            </button>
            <button
              type="button"
              className="app-icon-button app-menu-button"
              onClick={() => setNavOpen((open) => !open)}
              aria-label={t('sidebar.toggle_expand')}
              aria-expanded={navOpen}
            >
              {navOpen ? <IconClose /> : <IconMenu />}
            </button>
          </div>
        </div>

        {navOpen ? (
          <>
            <button
              type="button"
              className="app-mobile-backdrop"
              onClick={() => setNavOpen(false)}
              aria-label={t('common.close')}
            />
            <div className="app-mobile-menu">
              <div className="app-mobile-menu-head">
                <span>{t('sidebar.subtitle')}</span>
                <button
                  type="button"
                  className="app-icon-button"
                  onClick={() => setNavOpen(false)}
                  aria-label={t('common.close')}
                >
                  <IconClose />
                </button>
              </div>
              {mobileNavLinks}
            </div>
          </>
        ) : null}
      </header>

      <main ref={mainRef} className="app-main">
        <div className="app-content">
          <MainRoutes />
        </div>
      </main>
    </div>
  );
}

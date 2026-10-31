import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainRoutes } from '@/router/MainRoutes';
import { useAuthStore, useConfigStore, useLanguageStore, useNotificationStore, useThemeStore } from '@/stores';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import { IconRefreshCw, IconSearch } from '@/components/ui/icons';
import { CommandPalette } from './CommandPalette';
import { activeNavItem, isNavItemActive, NAV_GROUPS, type NavGroup } from './navigation';

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

function BrandMark() {
  return (
    <span className="app-brand-mark" aria-hidden="true">
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </span>
  );
}

function NavGroupSection({ group }: { group: NavGroup }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState({ y: 0, h: 0, visible: false, animated: false });

  const measure = useCallback(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[data-nav-active="true"]');
    if (!active) {
      setIndicator((current) => ({ ...current, visible: false }));
      return;
    }
    setIndicator((current) => ({
      ...current,
      y: active.offsetTop,
      h: active.offsetHeight,
      visible: true,
    }));
  }, []);

  useLayoutEffect(() => {
    measure();
    const frame = requestAnimationFrame(() =>
      setIndicator((current) => ({ ...current, animated: true }))
    );
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return (
    <div className="app-nav-group">
      <span className="app-nav-label">{t(group.labelKey)}</span>
      <nav ref={navRef} className="app-nav" aria-label={t(group.labelKey)}>
        <span
          className={`app-nav-indicator${indicator.visible ? ' is-visible' : ''}${indicator.animated ? ' is-animated' : ''}`}
          style={{ transform: `translateY(${indicator.y}px)`, height: `${indicator.h}px` }}
          aria-hidden="true"
        />
        {group.items.map((item) => {
          const active = isNavItemActive(item.path, location.pathname);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={() => `app-nav-link${active ? ' is-active' : ''}`}
              data-nav-active={active ? 'true' : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <span className="app-nav-icon">
                <item.icon size={17} />
              </span>
              <span className="app-nav-text">{t(item.labelKey)}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

export function MainLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const showActionFeedback = useNotificationStore((state) => state.showActionFeedback);

  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

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

  const handleLogout = useCallback(() => {
    showActionFeedback({
      variant: 'success',
      title: t('header.logout_success_title'),
      message: t('header.logout_success_message'),
      autoCloseMs: 1600,
    });
    logout();
  }, [logout, showActionFeedback, t]);

  const statusLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );

  const currentNavItem = activeNavItem(location.pathname);
  const currentPageLabel = currentNavItem ? t(currentNavItem.labelKey) : 'CLI Proxy';
  const versionLabel = serverVersion?.trim()
    ? `v${serverVersion.trim().replace(/^[vV]+/, '')}`
    : 'dev';

  return (
    <div className="app-shell">
      <div className="app-wallpaper" aria-hidden="true" />

      <aside className={`app-sidebar${navOpen ? ' is-open' : ''}`}>
        <div className="app-sidebar-inner">
          <NavLink to="/" className="app-brand" aria-label="CLI Proxy API">
            <BrandMark />
            <span className="app-brand-copy">
              <span className="app-brand-name">CLI Proxy</span>
              <span className="app-brand-sub">Management Console</span>
            </span>
          </NavLink>

          <button type="button" className="app-search" onClick={() => setPaletteOpen(true)}>
            <IconSearch size={15} />
            <span>{t('common.search')}</span>
            <kbd>Ctrl K</kbd>
          </button>

          <div className="app-nav-groups">
            {NAV_GROUPS.map((group) => (
              <NavGroupSection key={group.labelKey} group={group} />
            ))}
          </div>

          <div className="app-sidebar-foot">
            <div className="app-account-card">
              <span className="app-connection" title={statusLabel}>
                <span
                  className={`app-status-dot${connectionStatus === 'connected' ? ' is-live' : ''}`}
                  aria-hidden="true"
                />
                <span className="app-connection-label">{statusLabel}</span>
              </span>
              <div className="app-version">
                <span>Version</span>
                <strong>{versionLabel}</strong>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {navOpen ? (
        <button
          type="button"
          className="app-sidebar-scrim"
          onClick={() => setNavOpen(false)}
          aria-label={t('common.close')}
        />
      ) : null}

      <div className="app-stage">
        <header className="app-stage-bar">
          <button
            type="button"
            className="app-icon-button app-mobile-trigger"
            onClick={() => setNavOpen(true)}
            aria-label={t('sidebar.toggle_expand')}
            aria-expanded={navOpen}
          >
            <IconMenu />
          </button>
          <div className="app-stage-title">
            <small>CLI Proxy</small>
            <strong>{currentPageLabel}</strong>
          </div>
          <div className="app-stage-actions">
            <span className="app-connection" title={statusLabel}>
              <span
                className={`app-status-dot${connectionStatus === 'connected' ? ' is-live' : ''}`}
                aria-hidden="true"
              />
              <span className="app-connection-label">{statusLabel}</span>
            </span>
            <button
              type="button"
              className={`app-icon-button${refreshing ? ' is-spinning' : ''}`}
              onClick={() => void handleRefresh()}
              title={t('header.refresh_all')}
              aria-label={t('header.refresh_all')}
            >
              <IconRefreshCw size={16} />
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
              onClick={handleLogout}
              title={t('header.logout')}
              aria-label={t('header.logout')}
            >
              <IconLogout />
            </button>
          </div>
        </header>

        <main ref={mainRef} className="app-main">
          <div className="app-content">
            <div className="app-page" key={location.pathname}>
              <MainRoutes />
            </div>
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

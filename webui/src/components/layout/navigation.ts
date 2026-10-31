import type { ComponentType } from 'react';
import {
  IconKey,
  IconModelCluster,
  IconSidebarAuthFiles,
  IconSidebarDashboard,
  IconSidebarLogs,
  IconSidebarOauth,
  IconSidebarQuota,
  IconSidebarSystem,
  IconSlidersHorizontal,
  IconTimer,
} from '@/components/ui/icons';

export interface NavItem {
  path: string;
  labelKey: string;
  descriptionKey: string;
  icon: ComponentType<{ size?: number }>;
}

export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav_groups.operate',
    items: [
      {
        path: '/',
        labelKey: 'nav.dashboard',
        descriptionKey: 'nav_meta.dashboard',
        icon: IconSidebarDashboard,
      },
    ],
  },
  {
    labelKey: 'nav_groups.gateway',
    items: [
      {
        path: '/ai-providers',
        labelKey: 'nav.ai_providers',
        descriptionKey: 'nav_meta.ai_providers',
        icon: IconModelCluster,
      },
      {
        path: '/auth-files',
        labelKey: 'nav.auth_files',
        descriptionKey: 'nav_meta.auth_files',
        icon: IconSidebarAuthFiles,
      },
      {
        path: '/oauth',
        labelKey: 'nav.oauth',
        descriptionKey: 'nav_meta.oauth',
        icon: IconSidebarOauth,
      },
      {
        path: '/quota',
        labelKey: 'nav.quota_management',
        descriptionKey: 'nav_meta.quota_management',
        icon: IconSidebarQuota,
      },
    ],
  },
  {
    labelKey: 'nav_groups.observe',
    items: [
      {
        path: '/monitoring',
        labelKey: 'nav.monitoring',
        descriptionKey: 'nav_meta.monitoring',
        icon: IconTimer,
      },
      {
        path: '/logs',
        labelKey: 'nav.logs',
        descriptionKey: 'nav_meta.logs',
        icon: IconSidebarLogs,
      },
    ],
  },
  {
    labelKey: 'nav_groups.control',
    items: [
      {
        path: '/api-keys',
        labelKey: 'nav.api_keys',
        descriptionKey: 'nav_meta.api_keys',
        icon: IconKey,
      },
      {
        path: '/config',
        labelKey: 'nav.config_management',
        descriptionKey: 'nav_meta.config_management',
        icon: IconSlidersHorizontal,
      },
      {
        path: '/system',
        labelKey: 'nav.system_info',
        descriptionKey: 'nav_meta.system_info',
        icon: IconSidebarSystem,
      },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export function isNavItemActive(path: string, pathname: string): boolean {
  if (path === '/') return pathname === '/' || pathname === '/dashboard';
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isNavItemActive(item.path, pathname));
}

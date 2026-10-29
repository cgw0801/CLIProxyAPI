/**
 * 主题状态管理
 * 从原项目 src/modules/theme.js 迁移
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from '@/types';
import { STORAGE_KEY_THEME } from '@/utils/constants';

type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  initializeTheme: () => () => void;
}

const getSystemTheme = (): ResolvedTheme => {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
};

const applyTheme = (theme: ResolvedTheme) => {
  document.documentElement.setAttribute('data-theme', theme);
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: getSystemTheme(),
      resolvedTheme: getSystemTheme(),

      setTheme: (theme) => {
        applyTheme(theme);
        set({
          theme,
          resolvedTheme: theme,
        });
      },

      initializeTheme: () => {
        const savedTheme = get().theme as string;
        const theme: ResolvedTheme =
          savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : getSystemTheme();
        applyTheme(theme);
        set({ theme, resolvedTheme: theme });
        return () => {};
      },
    }),
    {
      name: STORAGE_KEY_THEME,
    }
  )
);

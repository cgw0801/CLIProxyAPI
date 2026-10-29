/**
 * Model catalog state with caching.
 */

import { create } from 'zustand';
import { apiKeysApi } from '@/services/api/apiKeys';
import { modelsApi } from '@/services/api/models';
import { CACHE_EXPIRY_MS } from '@/utils/constants';
import { normalizeModelList, type ModelInfo } from '@/utils/models';

interface ModelsCache {
  data: ModelInfo[];
  timestamp: number;
  apiBase: string;
  apiKey: string;
}

interface ModelsState {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  cache: ModelsCache | null;

  fetchModels: (apiBase: string, apiKey?: string, forceRefresh?: boolean) => Promise<ModelInfo[]>;
  fetchManagementModels: (forceRefresh?: boolean) => Promise<ModelInfo[]>;
  clearCache: () => void;
  isCacheValid: (apiBase: string, apiKey?: string) => boolean;
}

let modelsRequestToken = 0;

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  loading: false,
  error: null,
  cache: null,

  fetchModels: async (apiBase, apiKey, forceRefresh = false) => {
    const requestId = (modelsRequestToken += 1);
    const { cache, isCacheValid } = get();
    const apiKeyScope = apiKey?.trim() || '';

    // Return cached results when the scope has not changed.
    if (!forceRefresh && isCacheValid(apiBase, apiKeyScope) && cache) {
      set({ models: cache.data, loading: false, error: null });
      return cache.data;
    }

    set({ loading: true, error: null });

    try {
      const list = await modelsApi.fetchModels(apiBase, apiKeyScope || undefined);
      // Ignore stale responses after a newer request has taken ownership of the store.
      if (requestId !== modelsRequestToken) return list;
      const now = Date.now();

      set({
        models: list,
        loading: false,
        cache: { data: list, timestamp: now, apiBase, apiKey: apiKeyScope },
      });

      return list;
    } catch (error: unknown) {
      if (requestId !== modelsRequestToken) throw error;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Failed to fetch models';
      set({
        error: message,
        loading: false,
        models: [],
      });
      throw error;
    }
  },

  fetchManagementModels: async (forceRefresh = false) => {
    const requestId = (modelsRequestToken += 1);
    const cacheKey = 'management:available-models';
    const { cache, isCacheValid } = get();

    if (!forceRefresh && isCacheValid('management', cacheKey) && cache) {
      set({ models: cache.data, loading: false, error: null });
      return cache.data;
    }

    set({ loading: true, error: null });

    try {
      const payload = await apiKeysApi.availableModels();
      const list = normalizeModelList(payload, { dedupe: true });
      if (requestId !== modelsRequestToken) return list;
      set({
        models: list,
        loading: false,
        error: null,
        cache: { data: list, timestamp: Date.now(), apiBase: 'management', apiKey: cacheKey },
      });
      return list;
    } catch (error: unknown) {
      if (requestId !== modelsRequestToken) throw error;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Failed to fetch models';
      set({ error: message, loading: false, models: [] });
      throw error;
    }
  },

  clearCache: () => {
    modelsRequestToken += 1;
    set({ cache: null, models: [], loading: false, error: null });
  },

  isCacheValid: (apiBase, apiKey) => {
    const { cache } = get();
    if (!cache) return false;
    if (cache.apiBase !== apiBase) return false;
    const apiKeyScope = apiKey?.trim() || '';
    if ((cache.apiKey || '') !== apiKeyScope) return false;
    return Date.now() - cache.timestamp < CACHE_EXPIRY_MS;
  },
}));

/**
 * 版本相关 API
 */

import { apiClient } from './client';

export interface ServerVersionInfo {
  version: string;
  commit: string;
  build_date: string;
  repository: string;
  started_at?: string;
}

export interface ServerUpdateStatus {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  can_update: boolean;
  release_url?: string;
  release_notes?: string;
  published_at?: string;
}

export interface ServerUpdateResult {
  updated: boolean;
  version: string;
  message: string;
}

export interface ServerRestartResult {
  restarting: boolean;
  message: string;
}

export const versionApi = {
  getVersion: () => apiClient.get<ServerVersionInfo>('/server/version'),
  checkUpdate: () => apiClient.get<ServerUpdateStatus>('/server/update'),
  applyUpdate: () =>
    apiClient.post<ServerUpdateResult>('/server/update', undefined, { timeout: 10 * 60 * 1000 }),
  restartServer: () =>
    apiClient.post<ServerRestartResult>('/server/restart', undefined, { timeout: 15 * 1000 }),
};

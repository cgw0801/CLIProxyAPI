import { apiClient } from './client';

export interface ClientApiKey {
  id: string;
  name: string;
  key: string;
  models: string[];
}

export interface AvailableModel {
  id: string;
  display_name?: string;
  owned_by?: string;
  type?: string;
}

export interface ApiKeyInput {
  name: string;
  key: string;
  models: string[];
}

const PATH = '/access/keys';

export const apiKeysApi = {
  async list(): Promise<ClientApiKey[]> {
    const response = await apiClient.get<{ keys?: ClientApiKey[] }>(PATH);
    return Array.isArray(response?.keys) ? response.keys : [];
  },

  create: (input: ApiKeyInput) =>
    apiClient.post<{ key: ClientApiKey }>(PATH, input).then((response) => response.key),

  update: (id: string, input: ApiKeyInput) =>
    apiClient
      .put<{ key: ClientApiKey }>(`${PATH}/${encodeURIComponent(id)}`, input)
      .then((response) => response.key),

  remove: (id: string) => apiClient.delete(`${PATH}/${encodeURIComponent(id)}`),

  async availableModels(): Promise<AvailableModel[]> {
    const response = await apiClient.get<{ models?: AvailableModel[] }>('/access/models');
    return Array.isArray(response?.models) ? response.models : [];
  },
};

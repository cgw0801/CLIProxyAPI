import { apiClient } from './client';

export type MonitoringRange = '1h' | '6h' | '24h' | '7d' | '30d' | 'all';

export interface MonitoringEvent {
  id: number;
  timestamp: string;
  request_id?: string;
  trace_id?: string;
  provider: string;
  model: string;
  alias?: string;
  response_model?: string;
  endpoint?: string;
  auth_id?: string;
  auth_index?: string;
  auth_type?: string;
  api_key_hash?: string;
  api_key_masked?: string;
  api_key_label?: string;
  account_label?: string;
  client_ip?: string;
  user_agent?: string;
  source?: string;
  executor_type?: string;
  reasoning_effort?: string;
  service_tier?: string;
  status_code: number;
  failed: boolean;
  failure_summary?: string;
  latency_ms: number;
  ttft_ms?: number;
  tokens_per_second?: number;
  stream: boolean;
  generate: boolean;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
}

export interface MonitoringSummary {
  requests: number;
  success: number;
  failed: number;
  success_rate: number;
  average_latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  stream_requests: number;
}

export interface MonitoringGroupSummary {
  key: string;
  label?: string;
  detail?: string;
  requests: number;
  success: number;
  failed: number;
  success_rate: number;
  average_latency_ms: number;
  total_tokens: number;
  last_seen: string;
}

export interface MonitoringOption {
  value: string;
  label?: string;
  count: number;
}

export interface MonitoringOptions {
  providers: MonitoringOption[];
  models: MonitoringOption[];
  accounts: MonitoringOption[];
  api_keys: MonitoringOption[];
}

export interface MonitoringOverview {
  generated_at: string;
  events: MonitoringEvent[];
  total: number;
  has_more: boolean;
  page: number;
  page_size: number;
  total_pages: number;
  summary: MonitoringSummary;
  accounts: MonitoringGroupSummary[];
  api_keys: MonitoringGroupSummary[];
  options: MonitoringOptions;
  retained: number;
  max_events: number;
  persistent: boolean;
}

export interface MonitoringQuery {
  range: MonitoringRange;
  provider?: string;
  model?: string;
  account?: string;
  api_key?: string;
  status?: string;
  search?: string;
  limit?: number;
  page?: number;
  page_size?: number;
  before_id?: number;
}

export const monitoringApi = {
  overview(params: MonitoringQuery): Promise<MonitoringOverview> {
    return apiClient.get<MonitoringOverview>('/monitoring/overview', { params });
  },
  clear(): Promise<{ removed: number }> {
    return apiClient.delete<{ removed: number }>('/monitoring/events');
  },
};

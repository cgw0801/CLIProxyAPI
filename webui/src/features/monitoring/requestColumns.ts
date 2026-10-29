export const REQUEST_COLUMN_KEYS = [
  'apiKey',
  'model',
  'reasoning',
  'recentStatus',
  'status',
  'successRate',
  'calls',
  'tps',
  'cacheRate',
  'latency',
  'time',
] as const;

export type RequestColumnKey = (typeof REQUEST_COLUMN_KEYS)[number];

export interface RequestColumnsState {
  order: RequestColumnKey[];
  visible: RequestColumnKey[];
}

const STORAGE_KEY = 'monitoring.requests.columns';
const REQUEST_COLUMN_SET = new Set<string>(REQUEST_COLUMN_KEYS);

const defaultState = (): RequestColumnsState => ({
  order: [...REQUEST_COLUMN_KEYS],
  visible: [...REQUEST_COLUMN_KEYS],
});

export const normalizeRequestColumnOrder = (value: unknown): RequestColumnKey[] => {
  const ordered: RequestColumnKey[] = [];
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item !== 'string' || !REQUEST_COLUMN_SET.has(item)) return;
      const key = item as RequestColumnKey;
      if (!ordered.includes(key)) ordered.push(key);
    });
  }
  REQUEST_COLUMN_KEYS.forEach((key) => {
    if (!ordered.includes(key)) ordered.push(key);
  });
  return ordered;
};

const normalizeVisibleColumns = (value: unknown): RequestColumnKey[] => {
  if (!Array.isArray(value)) return [...REQUEST_COLUMN_KEYS];
  const visible = new Set<RequestColumnKey>();
  value.forEach((item) => {
    if (typeof item !== 'string' || !REQUEST_COLUMN_SET.has(item)) return;
    visible.add(item as RequestColumnKey);
  });
  if (visible.size === 0) return [...REQUEST_COLUMN_KEYS];
  return REQUEST_COLUMN_KEYS.filter((key) => visible.has(key));
};

export const readRequestColumnsState = (): RequestColumnsState => {
  if (typeof window === 'undefined') return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaultState();
    const source = parsed as Record<string, unknown>;
    return {
      order: normalizeRequestColumnOrder(source.order),
      visible: normalizeVisibleColumns(source.visible),
    };
  } catch {
    return defaultState();
  }
};

export const writeRequestColumnsState = (state: RequestColumnsState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
};

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiKeysApi, type AvailableModel, type ClientApiKey } from '@/services/api/apiKeys';
import { useAuthStore, useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import styles from './ApiKeysPage.module.scss';

interface Draft {
  name: string;
  key: string;
  models: string[];
}

const ALL_MODELS = '*';
const EMPTY_DRAFT: Draft = { name: '', key: '', models: [] };

const createSecret = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `sk-cpa-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
};

const maskKey = (value: string): string => {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}••••••${value.slice(-4)}`;
};

const allowsAllModels = (models: string[]): boolean => models.includes(ALL_MODELS);

export function ApiKeysPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();
  const [keys, setKeys] = useState<ClientApiKey[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ClientApiKey | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [modelQuery, setModelQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const connected = connectionStatus === 'connected';
  const permissionAll = allowsAllModels(draft.models);

  const load = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      return;
    }
    setError('');
    try {
      const [keyList, modelList] = await Promise.all([
        apiKeysApi.list(),
        apiKeysApi.availableModels(),
      ]);
      setKeys(keyList);
      setModels(modelList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    void load();
  }, [load]);

  useHeaderRefresh(load, connected);

  const selectedModels = useMemo(
    () => draft.models.filter((model) => model !== ALL_MODELS),
    [draft.models]
  );

  const modelOptions = useMemo(() => {
    const seen = new Set(models.map((model) => model.id));
    const extras: AvailableModel[] = selectedModels
      .filter((model) => !seen.has(model))
      .map((model) => ({ id: model }));
    return [...models, ...extras].sort((a, b) => a.id.localeCompare(b.id));
  }, [models, selectedModels]);

  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) return modelOptions;
    return modelOptions.filter((model) => model.id.toLowerCase().includes(query));
  }, [modelOptions, modelQuery]);

  const openCreate = () => {
    setEditing(null);
    setDraft({ ...EMPTY_DRAFT, key: createSecret() });
    setModelQuery('');
    setEditorOpen(true);
  };

  const openEdit = (key: ClientApiKey) => {
    setEditing(key);
    setDraft({ name: key.name, key: key.key, models: [...key.models] });
    setModelQuery('');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  };

  const setPermissionAll = (all: boolean) => {
    setDraft((current) => ({ ...current, models: all ? [ALL_MODELS] : [] }));
  };

  const toggleModel = (modelId: string) => {
    setDraft((current) => {
      if (allowsAllModels(current.models)) return current;
      return {
        ...current,
        models: current.models.includes(modelId)
          ? current.models.filter((model) => model !== modelId)
          : [...current.models, modelId],
      };
    });
  };

  const handleSave = async () => {
    if (!draft.key.trim()) {
      showNotification(t('api_keys.error_key_required'), 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: draft.name.trim(), key: draft.key.trim(), models: draft.models };
      if (editing) {
        const updated = await apiKeysApi.update(editing.id, payload);
        setKeys((current) => current.map((key) => (key.id === updated.id ? updated : key)));
      } else {
        const created = await apiKeysApi.create(payload);
        setKeys((current) => [...current, created]);
      }
      showNotification(editing ? t('api_keys.saved') : t('api_keys.created'), 'success');
      setEditorOpen(false);
      setEditing(null);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (key: ClientApiKey) => {
    showConfirmation({
      title: t('api_keys.delete_title'),
      message: t('api_keys.delete_message', { name: key.name }),
      variant: 'danger',
      confirmText: t('common.delete'),
      onConfirm: async () => {
        try {
          await apiKeysApi.remove(key.id);
          setKeys((current) => current.filter((item) => item.id !== key.id));
          showNotification(t('api_keys.deleted'), 'success');
        } catch (err) {
          showNotification(err instanceof Error ? err.message : String(err), 'error');
        }
      },
    });
  };

  const handleCopy = async (key: ClientApiKey) => {
    try {
      await copyToClipboard(key.key);
      showNotification(t('api_keys.copied'), 'success');
    } catch {
      showNotification(t('api_keys.copy_failed'), 'error');
    }
  };

  const toggleReveal = (id: string) => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const permissionLabel = (key: ClientApiKey): string => {
    if (allowsAllModels(key.models)) return t('api_keys.all_models');
    if (key.models.length === 0) return t('api_keys.no_model_access');
    return t('api_keys.model_count', { count: key.models.length });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>{t('api_keys.title')}</h1>
          <p>{t('api_keys.subtitle')}</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.quietButton} onClick={() => void load()}>
            {t('common.refresh')}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={openCreate}
            disabled={!connected}
          >
            {t('api_keys.create')}
          </button>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      <section className={styles.listSection} aria-busy={loading}>
        <div className={styles.listMeta}>
          <span>{t('api_keys.count', { count: keys.length })}</span>
          <span>{t('api_keys.policy_hint')}</span>
        </div>

        {loading ? (
          <p className={styles.empty}>{t('common.loading')}</p>
        ) : keys.length === 0 ? (
          <div className={styles.emptyState}>
            <h2>{t('api_keys.empty')}</h2>
            <p>{t('api_keys.empty_hint')}</p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={openCreate}
              disabled={!connected}
            >
              {t('api_keys.create')}
            </button>
          </div>
        ) : (
          <div className={styles.keyList}>
            {keys.map((key) => {
              const modelPreview = allowsAllModels(key.models) ? [] : key.models.slice(0, 4);
              return (
                <article key={key.id} className={styles.keyCard}>
                  <div className={styles.keyMain}>
                    <div className={styles.titleRow}>
                      <h2>{key.name}</h2>
                      <span
                        className={`${styles.permissionBadge}${
                          key.models.length === 0 ? ` ${styles.permissionEmpty}` : ''
                        }`}
                      >
                        {permissionLabel(key)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.secret}
                      onClick={() => toggleReveal(key.id)}
                      title={t('api_keys.reveal')}
                    >
                      {revealed.has(key.id) ? key.key : maskKey(key.key)}
                    </button>
                    {modelPreview.length > 0 ? (
                      <div className={styles.modelPreview}>
                        {modelPreview.map((model) => (
                          <span key={model} className={styles.modelChip}>
                            {model}
                          </span>
                        ))}
                        {key.models.length > modelPreview.length ? (
                          <span className={styles.modelChip}>
                            +{key.models.length - modelPreview.length}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.rowActions}>
                    <button type="button" onClick={() => void handleCopy(key)}>
                      {t('common.copy')}
                    </button>
                    <button type="button" onClick={() => openEdit(key)}>
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      onClick={() => handleDelete(key)}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={editorOpen}
        onClose={closeEditor}
        title={editing ? t('api_keys.edit') : t('api_keys.create')}
        width={760}
        closeDisabled={saving}
        footer={
          <>
            <Button variant="secondary" onClick={closeEditor} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleSave()} loading={saving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>{t('api_keys.name')}</span>
              <input
                className="input"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder={t('api_keys.name_placeholder')}
              />
            </label>
            <label className={styles.field}>
              <span>{t('api_keys.key')}</span>
              <div className={styles.secretRow}>
                <input
                  className="input"
                  value={draft.key}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, key: event.target.value }))
                  }
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, key: createSecret() }))}
                >
                  {t('api_keys.generate')}
                </button>
              </div>
            </label>
          </div>

          <section className={styles.modelField}>
            <div className={styles.modelHead}>
              <div>
                <span className={styles.fieldTitle}>{t('api_keys.permission')}</span>
                <p>{t('api_keys.models_hint')}</p>
              </div>
              <div
                className={styles.permissionSwitch}
                role="group"
                aria-label={t('api_keys.permission')}
              >
                <button
                  type="button"
                  className={!permissionAll ? styles.permissionActive : undefined}
                  onClick={() => setPermissionAll(false)}
                >
                  {t('api_keys.specific_models')}
                </button>
                <button
                  type="button"
                  className={permissionAll ? styles.permissionActive : undefined}
                  onClick={() => setPermissionAll(true)}
                >
                  {t('api_keys.all_models')}
                </button>
              </div>
            </div>

            {permissionAll ? (
              <div className={styles.allModelsPanel}>
                <strong>{t('api_keys.all_models')}</strong>
                <span>{t('api_keys.selection_all')}</span>
              </div>
            ) : (
              <>
                <div className={styles.modelToolbar}>
                  <input
                    className={`input ${styles.modelSearch}`}
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder={t('api_keys.search_models')}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        models: Array.from(
                          new Set([
                            ...current.models.filter((model) => model !== ALL_MODELS),
                            ...filteredModels.map((model) => model.id),
                          ])
                        ),
                      }))
                    }
                  >
                    {t('api_keys.select_visible')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, models: [] }))}
                  >
                    {t('api_keys.clear_selection')}
                  </button>
                </div>
                <div className={styles.modelList}>
                  {filteredModels.length === 0 ? (
                    <p className={styles.empty}>{t('api_keys.no_models')}</p>
                  ) : (
                    filteredModels.map((model) => (
                      <label key={model.id} className={styles.modelOption}>
                        <input
                          type="checkbox"
                          checked={selectedModels.includes(model.id)}
                          onChange={() => toggleModel(model.id)}
                        />
                        <span>{model.id}</span>
                        {model.owned_by ? <small>{model.owned_by}</small> : null}
                      </label>
                    ))
                  )}
                </div>
                <p
                  className={
                    selectedModels.length === 0 ? styles.selectionWarning : styles.selectionSummary
                  }
                >
                  {selectedModels.length === 0
                    ? t('api_keys.selection_none')
                    : t('api_keys.selection_count', { count: selectedModels.length })}
                </p>
              </>
            )}
          </section>
        </div>
      </Modal>
    </div>
  );
}

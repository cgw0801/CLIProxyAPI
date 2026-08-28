package management

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
)

type modelACLItem struct {
	Key        string   `json:"key"`
	Restricted bool     `json:"restricted"`
	Models     []string `json:"models"`
}

type modelACLModel struct {
	ID          string   `json:"id"`
	DisplayName string   `json:"display_name,omitempty"`
	Providers   []string `json:"providers,omitempty"`
}

func normalizeModelACLValues(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" || value == "*" {
			continue
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func reconcileModelACLKeys(before, after []string, acl config.ModelACL) config.ModelACL {
	if len(acl) == 0 {
		return nil
	}
	out := make(config.ModelACL)
	beforeSet := make(map[string]struct{}, len(before))
	afterSet := make(map[string]struct{}, len(after))
	for _, rawKey := range before {
		if key := strings.TrimSpace(rawKey); key != "" {
			beforeSet[key] = struct{}{}
		}
	}
	for _, rawKey := range after {
		if key := strings.TrimSpace(rawKey); key != "" {
			afterSet[key] = struct{}{}
		}
	}
	for index, rawKey := range after {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			continue
		}
		if models, exists := acl[key]; exists {
			out[key] = append([]string(nil), models...)
			continue
		}
		if len(before) != len(after) || index >= len(before) {
			continue
		}
		oldKey := strings.TrimSpace(before[index])
		if _, oldStillPresent := afterSet[oldKey]; oldStillPresent {
			continue
		}
		if _, newAlreadyPresent := beforeSet[key]; newAlreadyPresent {
			continue
		}
		if models, exists := acl[oldKey]; exists {
			out[key] = append([]string(nil), models...)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// GetModelACL returns inbound API keys, their assignments, and currently
// available models for the fork's model allocation screen.
func (h *Handler) GetModelACL(c *gin.Context) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.cfg == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "config unavailable"})
		return
	}

	items := make([]modelACLItem, 0, len(h.cfg.APIKeys))
	assigned := make(map[string]struct{})
	for _, rawKey := range h.cfg.APIKeys {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			continue
		}
		models, restricted := h.cfg.ModelACL.AllowedModels(key)
		models = normalizeModelACLValues(models)
		for _, model := range models {
			assigned[model] = struct{}{}
		}
		items = append(items, modelACLItem{Key: key, Restricted: restricted, Models: models})
	}

	reg := registry.GetGlobalRegistry()
	available := reg.GetAvailableModelInfos()
	modelsByID := make(map[string]modelACLModel, len(available)+len(assigned))
	for _, model := range available {
		if model == nil || strings.TrimSpace(model.ID) == "" {
			continue
		}
		id := strings.TrimSpace(model.ID)
		modelsByID[id] = modelACLModel{
			ID:          id,
			DisplayName: strings.TrimSpace(model.DisplayName),
			Providers:   reg.GetModelProviders(id),
		}
	}
	for id := range assigned {
		if _, exists := modelsByID[id]; !exists {
			modelsByID[id] = modelACLModel{ID: id}
		}
	}
	models := make([]modelACLModel, 0, len(modelsByID))
	for _, model := range modelsByID {
		models = append(models, model)
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": items, "models": models})
}

// PutModelACL atomically replaces the inbound key list and its assignments.
func (h *Handler) PutModelACL(c *gin.Context) {
	var body struct {
		Items []modelACLItem `json:"items"`
	}
	if errBind := c.ShouldBindJSON(&body); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	keys := make([]string, 0, len(body.Items))
	acl := make(config.ModelACL)
	seen := make(map[string]struct{}, len(body.Items))
	for _, item := range body.Items {
		key := strings.TrimSpace(item.Key)
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "API key cannot be empty"})
			return
		}
		if _, exists := seen[key]; exists {
			c.JSON(http.StatusBadRequest, gin.H{"error": "duplicate API key"})
			return
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
		if !item.Restricted {
			continue
		}
		models := normalizeModelACLValues(item.Models)
		if len(models) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "restricted API keys require at least one model"})
			return
		}
		acl[key] = models
	}
	if len(acl) == 0 {
		acl = nil
	}

	h.mu.Lock()
	if h.cfg == nil {
		h.mu.Unlock()
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "config unavailable"})
		return
	}
	h.cfg.APIKeys = keys
	h.cfg.ModelACL = acl
	snapshot, saved := h.saveConfigAndSnapshotLocked(c)
	h.mu.Unlock()
	if !saved {
		return
	}
	h.reloadConfigAfterManagementSaveAsync(c.Request.Context(), snapshot)
	c.JSON(http.StatusOK, gin.H{"status": "ok", "items": len(keys)})
}

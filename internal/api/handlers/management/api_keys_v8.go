package management

import (
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/apikeys"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
)

type apiKeyRequest struct {
	Name   string   `json:"name"`
	Key    string   `json:"key"`
	Models []string `json:"models"`
}

// ListAPIKeysV8 returns client API keys with their model allow-lists.
func (h *Handler) ListAPIKeysV8(c *gin.Context) {
	store := h.apiKeyStoreSnapshot()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "api key store is unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"keys": store.List()})
}

// CreateAPIKeyV8 creates a client API key.
func (h *Handler) CreateAPIKeyV8(c *gin.Context) {
	store := h.apiKeyStoreSnapshot()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "api key store is unavailable"})
		return
	}
	var request apiKeyRequest
	if errBind := c.ShouldBindJSON(&request); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	key, errCreate := store.Create(request.Name, request.Key, request.Models)
	if errCreate != nil {
		writeAPIKeyError(c, errCreate)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"key": key})
}

// UpdateAPIKeyV8 updates a client API key.
func (h *Handler) UpdateAPIKeyV8(c *gin.Context) {
	store := h.apiKeyStoreSnapshot()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "api key store is unavailable"})
		return
	}
	var request apiKeyRequest
	if errBind := c.ShouldBindJSON(&request); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	key, errUpdate := store.Update(c.Param("id"), request.Name, request.Key, request.Models)
	if errUpdate != nil {
		writeAPIKeyError(c, errUpdate)
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": key})
}

// DeleteAPIKeyV8 deletes a client API key.
func (h *Handler) DeleteAPIKeyV8(c *gin.Context) {
	store := h.apiKeyStoreSnapshot()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "api key store is unavailable"})
		return
	}
	if errDelete := store.Delete(c.Param("id")); errDelete != nil {
		writeAPIKeyError(c, errDelete)
		return
	}
	c.Status(http.StatusNoContent)
}

// ListAvailableModelsV8 returns model IDs that can be assigned to a client key.
func (h *Handler) ListAvailableModelsV8(c *gin.Context) {
	infos := registry.GetGlobalRegistry().GetAvailableModelInfos()
	models := make([]map[string]any, 0, len(infos))
	seen := make(map[string]struct{}, len(infos))
	for _, info := range infos {
		if info == nil {
			continue
		}
		id := strings.TrimSpace(info.ID)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		entry := map[string]any{"id": id}
		if info.DisplayName != "" {
			entry["display_name"] = info.DisplayName
		}
		if info.OwnedBy != "" {
			entry["owned_by"] = info.OwnedBy
		}
		if info.Type != "" {
			entry["type"] = info.Type
		}
		models = append(models, entry)
	}
	sort.Slice(models, func(i, j int) bool {
		return strings.ToLower(models[i]["id"].(string)) < strings.ToLower(models[j]["id"].(string))
	})
	c.JSON(http.StatusOK, gin.H{"models": models})
}

func (h *Handler) apiKeyStoreSnapshot() *apikeys.Store {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.apiKeyStore
}

func writeAPIKeyError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, apikeys.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "api key not found"})
	case errors.Is(err, apikeys.ErrDuplicateKey):
		c.JSON(http.StatusConflict, gin.H{"error": "api key already exists"})
	case errors.Is(err, apikeys.ErrEmptyKey):
		c.JSON(http.StatusBadRequest, gin.H{"error": "api key must not be empty"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

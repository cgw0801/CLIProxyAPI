package management

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestmonitor"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

type monitoringEvent struct {
	requestmonitor.Event
	AccountLabel string `json:"account_label,omitempty"`
	APIKeyLabel  string `json:"api_key_label,omitempty"`
}

type monitoringOverviewResponse struct {
	GeneratedAt time.Time `json:"generated_at"`
	requestmonitor.QueryResult
	Events     []monitoringEvent `json:"events"`
	Page       int               `json:"page"`
	PageSize   int               `json:"page_size"`
	TotalPages int               `json:"total_pages"`
}

// GetMonitoringOverview returns recent request events and their aggregates.
func (h *Handler) GetMonitoringOverview(c *gin.Context) {
	if h == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "handler not initialized"})
		return
	}
	store := requestmonitor.Default()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "request monitor unavailable"})
		return
	}
	options, errOptions := parseMonitoringQuery(c)
	if errOptions != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": errOptions.Error()})
		return
	}

	result := store.Query(options)
	labels := h.monitoringLabels()
	maskedKeys := make(map[string]string)
	events := make([]monitoringEvent, 0, len(result.Events))
	for _, event := range result.Events {
		view := monitoringEvent{Event: event}
		if label := labels.accounts[requestmonitor.AccountKey(event)]; label != "" {
			view.AccountLabel = label
		}
		if label := labels.apiKeys[event.APIKeyHash]; label != "" {
			view.APIKeyLabel = label
		}
		if event.APIKeyHash != "" && event.APIKeyMasked != "" {
			maskedKeys[event.APIKeyHash] = event.APIKeyMasked
		}
		events = append(events, view)
	}
	for i := range result.Accounts {
		group := &result.Accounts[i]
		if label := labels.accounts[group.Key]; label != "" {
			group.Label = label
		}
		if group.Key == "unknown" {
			group.Label = "未知账号"
		}
	}
	for i := range result.APIKeys {
		group := &result.APIKeys[i]
		if label := labels.apiKeys[group.Key]; label != "" {
			group.Label = label
		} else if group.Key == "unknown" {
			group.Label = "未识别密钥"
		}
		if mask := maskedKeys[group.Key]; mask != "" {
			group.Detail = mask
		}
	}
	for i := range result.Options.Accounts {
		option := &result.Options.Accounts[i]
		if label := labels.accounts[option.Value]; label != "" {
			option.Label = label
		}
		if option.Value == "unknown" {
			option.Label = "未知账号"
		}
	}
	for i := range result.Options.APIKeys {
		option := &result.Options.APIKeys[i]
		if label := labels.apiKeys[option.Value]; label != "" {
			option.Label = label
		} else if option.Value == "unknown" {
			option.Label = "未识别密钥"
		}
	}

	c.JSON(http.StatusOK, monitoringOverviewResponse{
		GeneratedAt: time.Now().UTC(),
		QueryResult: result,
		Events:      events,
		Page:        options.Page,
		PageSize:    options.Limit,
		TotalPages:  totalPages(result.Total, options.Limit),
	})
}

// DeleteMonitoringEvents clears the retained request history.
func (h *Handler) DeleteMonitoringEvents(c *gin.Context) {
	if h == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "handler not initialized"})
		return
	}
	store := requestmonitor.Default()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "request monitor unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": store.Clear()})
}

type monitoringLabelSet struct {
	accounts map[string]string
	apiKeys  map[string]string
}

func totalPages(total, pageSize int) int {
	if total <= 0 || pageSize <= 0 {
		return 1
	}
	return (total + pageSize - 1) / pageSize
}

func (h *Handler) monitoringLabels() monitoringLabelSet {
	labels := monitoringLabelSet{
		accounts: make(map[string]string),
		apiKeys:  make(map[string]string),
	}
	h.mu.Lock()
	manager := h.authManager
	keyStore := h.apiKeyStore
	h.mu.Unlock()

	if manager != nil {
		for _, auth := range manager.List() {
			if auth == nil {
				continue
			}
			label := monitoringAuthLabel(auth)
			if label == "" {
				continue
			}
			if index := strings.TrimSpace(auth.Index); index != "" {
				labels.accounts[index] = label
			}
			if id := strings.TrimSpace(auth.ID); id != "" {
				labels.accounts[id] = label
			}
		}
	}
	if keyStore != nil {
		for _, key := range keyStore.List() {
			if strings.TrimSpace(key.Key) == "" {
				continue
			}
			label := strings.TrimSpace(key.Name)
			if label == "" {
				label = "未命名密钥"
			}
			labels.apiKeys[requestmonitor.HashAPIKey(key.Key)] = label
		}
	}
	return labels
}

func monitoringAuthLabel(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if label := strings.TrimSpace(auth.Label); label != "" {
		return label
	}
	if fileName := strings.TrimSpace(auth.FileName); fileName != "" {
		return fileName
	}
	if _, account := auth.AccountInfo(); strings.TrimSpace(account) != "" {
		return strings.TrimSpace(account)
	}
	if id := strings.TrimSpace(auth.ID); id != "" {
		return id
	}
	return strings.TrimSpace(auth.Index)
}

func parseMonitoringQuery(c *gin.Context) (requestmonitor.QueryOptions, error) {
	options := requestmonitor.QueryOptions{
		Limit: 100,
		Page:  1,
	}
	if c == nil {
		return options, nil
	}
	rangeValue := strings.ToLower(strings.TrimSpace(c.Query("range")))
	if rangeValue == "" {
		rangeValue = "24h"
	}
	now := time.Now()
	switch rangeValue {
	case "1h":
		options.Since = now.Add(-time.Hour)
	case "6h":
		options.Since = now.Add(-6 * time.Hour)
	case "24h", "today":
		options.Since = now.Add(-24 * time.Hour)
	case "7d":
		options.Since = now.Add(-7 * 24 * time.Hour)
	case "30d":
		options.Since = now.Add(-30 * 24 * time.Hour)
	case "all":
	case "custom":
		fromRaw := strings.TrimSpace(c.Query("from_ms"))
		if fromRaw == "" {
			return options, errors.New("from_ms is required for custom range")
		}
		fromMs, errFrom := strconv.ParseInt(fromRaw, 10, 64)
		if errFrom != nil || fromMs <= 0 {
			return options, errors.New("from_ms must be a positive unix millisecond timestamp")
		}
		options.Since = time.UnixMilli(fromMs)
	default:
		return options, errors.New("range must be one of 1h, 6h, 24h, 7d, 30d, all, custom")
	}
	options.Provider = strings.TrimSpace(c.Query("provider"))
	options.Model = strings.TrimSpace(c.Query("model"))
	options.Account = strings.TrimSpace(c.Query("account"))
	options.APIKeyHash = strings.TrimSpace(c.Query("api_key"))
	options.Status = strings.TrimSpace(c.Query("status"))
	options.Search = strings.TrimSpace(c.Query("search"))
	if pageRaw := strings.TrimSpace(c.Query("page")); pageRaw != "" {
		page, errPage := strconv.Atoi(pageRaw)
		if errPage != nil || page <= 0 {
			return options, errors.New("page must be a positive integer")
		}
		options.Page = page
	}
	if pageSizeRaw := strings.TrimSpace(c.Query("page_size")); pageSizeRaw != "" {
		pageSize, errPageSize := strconv.Atoi(pageSizeRaw)
		if errPageSize != nil || pageSize <= 0 {
			return options, errors.New("page_size must be a positive integer")
		}
		if pageSize > 500 {
			return options, errors.New("page_size must not exceed 500")
		}
		options.Limit = pageSize
	}
	if limitRaw := strings.TrimSpace(c.Query("limit")); limitRaw != "" {
		limit, errLimit := strconv.Atoi(limitRaw)
		if errLimit != nil || limit <= 0 {
			return options, errors.New("limit must be a positive integer")
		}
		options.Limit = limit
	}
	options.Offset = (options.Page - 1) * options.Limit
	if beforeRaw := strings.TrimSpace(c.Query("before_id")); beforeRaw != "" {
		beforeID, errBefore := strconv.ParseInt(beforeRaw, 10, 64)
		if errBefore != nil || beforeID <= 0 {
			return options, errors.New("before_id must be a positive integer")
		}
		options.BeforeID = beforeID
	}
	return options, nil
}

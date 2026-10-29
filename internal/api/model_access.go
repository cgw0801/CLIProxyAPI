package api

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	claudemodels "github.com/router-for-me/CLIProxyAPI/v8/internal/client/claude/models"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers"
	"github.com/tidwall/gjson"
)

const allModelsWildcard = "*"

// modelAccessMiddleware enforces per-key model allow-lists after authentication.
func (s *Server) modelAccessMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if s == nil || s.apiKeyStore == nil || c == nil || c.Request == nil {
			c.Next()
			return
		}
		principal, exists := c.Get("userApiKey")
		if !exists {
			c.Next()
			return
		}
		key, ok := s.apiKeyStore.FindByKey(strings.TrimSpace(toString(principal)))
		if !ok {
			c.Next()
			return
		}
		if modelsAllowAll(key.Models) {
			c.Next()
			return
		}

		allowed := make(map[string]struct{}, len(key.Models)*2)
		for _, model := range key.Models {
			model = strings.TrimSpace(model)
			if model == "" {
				continue
			}
			allowed[model] = struct{}{}
			allowed[claudemodels.EnsureClaudeModelIDPrefix(model)] = struct{}{}
		}
		// An empty allow-list is explicit: this key may authenticate but cannot
		// access any model. Keep it in the context so model catalog responses are
		// filtered to an empty list as well.
		c.Set(handlers.AllowedModelsContextKey, allowed)

		model := requestModel(c)
		if model == "" || modelAllowed(model, allowed) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": gin.H{
			"message": "API key is not allowed to use model " + model,
			"type":    "permission_error",
			"param":   "model",
			"code":    "model_not_allowed",
		}})
	}
}

func modelsAllowAll(models []string) bool {
	for _, model := range models {
		if strings.TrimSpace(model) == allModelsWildcard {
			return true
		}
	}
	return false
}

func requestModel(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	path := c.Request.URL.Path
	switch {
	case strings.HasPrefix(path, "/v1beta/models/"):
		return normalizeRequestModel(strings.TrimPrefix(path, "/v1beta/models/"))
	case strings.HasPrefix(path, "/v1/models/"):
		return normalizeRequestModel(strings.TrimPrefix(path, "/v1/models/"))
	}
	if model := strings.TrimSpace(c.Query("model")); model != "" {
		return normalizeRequestModel(model)
	}
	if c.Request.Body == nil || c.Request.Body == http.NoBody {
		return ""
	}
	contentType := strings.ToLower(c.Request.Header.Get("Content-Type"))
	if contentType != "" && !strings.Contains(contentType, "application/json") {
		return ""
	}
	body, errRead := io.ReadAll(c.Request.Body)
	if errRead != nil {
		return ""
	}
	_ = c.Request.Body.Close()
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	c.Request.ContentLength = int64(len(body))
	c.Request.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}
	if len(body) == 0 || !gjson.ValidBytes(body) {
		return ""
	}
	return normalizeRequestModel(gjson.GetBytes(body, "model").String())
}

func normalizeRequestModel(model string) string {
	model = strings.TrimSpace(model)
	model = strings.TrimPrefix(model, "models/")
	if index := strings.Index(model, ":"); index > 0 {
		model = model[:index]
	}
	if strings.HasSuffix(model, ")") {
		if index := strings.LastIndex(model, "("); index > 0 {
			model = model[:index]
		}
	}
	return strings.TrimSpace(model)
}

func modelAllowed(model string, allowed map[string]struct{}) bool {
	normalized := normalizeRequestModel(model)
	if normalized == "" {
		return true
	}
	if _, ok := allowed[allModelsWildcard]; ok {
		return true
	}
	if _, ok := allowed[normalized]; ok {
		return true
	}
	resolved := normalizeRequestModel(claudemodels.ResolveClaudeModelIDPrefix(normalized))
	if _, ok := allowed[resolved]; ok {
		return true
	}
	if ensured := claudemodels.EnsureClaudeModelIDPrefix(normalized); ensured != normalized {
		if _, ok := allowed[ensured]; ok {
			return true
		}
	}
	for candidate := range allowed {
		candidate = normalizeRequestModel(candidate)
		if candidate == "" || candidate == allModelsWildcard {
			continue
		}
		if strings.HasSuffix(normalized, "/"+candidate) || strings.HasSuffix(candidate, "/"+normalized) {
			return true
		}
	}
	return false
}

func toString(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/apikeys"
)

func TestModelAccessMiddlewareEmptyAllowListDeniesAllModels(t *testing.T) {
	router := newModelAccessTestRouter(t, "sk-empty", []string{})
	response := performModelAccessRequest(router, `{"model":"gpt-5"}`)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
	}
}

func TestModelAccessMiddlewareWildcardAllowsAllModels(t *testing.T) {
	router := newModelAccessTestRouter(t, "sk-all", []string{"*"})
	response := performModelAccessRequest(router, `{"model":"any-model"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
}

func TestModelAccessMiddlewareSelectedModels(t *testing.T) {
	router := newModelAccessTestRouter(t, "sk-selected", []string{"gpt-5", "claude-sonnet-4"})
	allowed := performModelAccessRequest(router, `{"model":"gpt-5"}`)
	if allowed.Code != http.StatusOK {
		t.Fatalf("allowed status = %d, want %d; body=%s", allowed.Code, http.StatusOK, allowed.Body.String())
	}
	denied := performModelAccessRequest(router, `{"model":"gemini-3-pro"}`)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("denied status = %d, want %d; body=%s", denied.Code, http.StatusForbidden, denied.Body.String())
	}
}

func TestModelsAllowAllRequiresExactWildcard(t *testing.T) {
	if modelsAllowAll(nil) {
		t.Fatal("nil allow-list must not allow all models")
	}
	if modelsAllowAll([]string{"gpt-5"}) {
		t.Fatal("concrete model allow-list must not allow all models")
	}
	if !modelsAllowAll([]string{"*"}) {
		t.Fatal("wildcard allow-list must allow all models")
	}
}

func newModelAccessTestRouter(t *testing.T, secret string, models []string) *gin.Engine {
	t.Helper()
	store := apikeys.NewMemory(nil)
	if _, errCreate := store.Create("test", secret, models); errCreate != nil {
		t.Fatalf("Create() error = %v", errCreate)
	}
	server := &Server{apiKeyStore: store}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("userApiKey", secret)
		c.Next()
	})
	router.Use(server.modelAccessMiddleware())
	router.POST("/v1/chat/completions", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	return router
}

func performModelAccessRequest(router *gin.Engine, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

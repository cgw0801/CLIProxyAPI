package handlers

import (
	"encoding/json"
	"testing"

	"github.com/gin-gonic/gin"
	claudemodels "github.com/router-for-me/CLIProxyAPI/v8/internal/client/claude/models"
)

func TestAllowedModelsFromContextKeepsExplicitEmptyAllowList(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(nil)
	context.Set(AllowedModelsContextKey, map[string]struct{}{})

	allowed, ok := allowedModelsFromContext(context)
	if !ok {
		t.Fatal("explicit empty allow-list must be treated as a restriction")
	}
	if len(allowed) != 0 {
		t.Fatalf("allowed = %#v, want empty", allowed)
	}
}

func TestFilterModelListBodyEmptyAllowListReturnsNoModels(t *testing.T) {
	body := []byte(`{"data":[{"id":"gpt-5"}],"models":[{"id":"claude-sonnet-4"}]}`)
	filtered := filterModelListBody(body, map[string]struct{}{})

	var payload struct {
		Data   []json.RawMessage `json:"data"`
		Models []json.RawMessage `json:"models"`
	}
	if errUnmarshal := json.Unmarshal(filtered, &payload); errUnmarshal != nil {
		t.Fatalf("Unmarshal() error = %v", errUnmarshal)
	}
	if len(payload.Data) != 0 || len(payload.Models) != 0 {
		t.Fatalf("filtered payload = %s, want empty data and models", filtered)
	}
}

func TestFilterModelListBodyMatchesClaudeCatalogAliases(t *testing.T) {
	allowed := map[string]struct{}{"gpt-5": {}}
	aliased := claudemodels.EnsureClaudeModelIDPrefix("gpt-5")
	body := []byte(`{"data":[{"id":"` + aliased + `"},{"id":"other"}]}`)
	filtered := filterModelListBody(body, allowed)

	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if errUnmarshal := json.Unmarshal(filtered, &payload); errUnmarshal != nil {
		t.Fatalf("Unmarshal() error = %v", errUnmarshal)
	}
	if len(payload.Data) != 1 || payload.Data[0].ID != aliased {
		t.Fatalf("filtered payload = %s, want Claude alias only", filtered)
	}
}

func TestFilterModelListBodyMatchesProviderPathSuffix(t *testing.T) {
	for _, test := range []struct {
		name    string
		allowed string
		id      string
	}{
		{name: "allowed has provider prefix", allowed: "anthropic/claude-sonnet-4", id: "claude-sonnet-4"},
		{name: "catalog has provider prefix", allowed: "claude-sonnet-4", id: "anthropic/claude-sonnet-4"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := []byte(`{"data":[{"id":"` + test.id + `"},{"id":"unrelated"}]}`)
			filtered := filterModelListBody(body, map[string]struct{}{test.allowed: {}})
			var payload struct {
				Data []json.RawMessage `json:"data"`
			}
			if errUnmarshal := json.Unmarshal(filtered, &payload); errUnmarshal != nil {
				t.Fatalf("Unmarshal() error = %v", errUnmarshal)
			}
			if len(payload.Data) != 1 {
				t.Fatalf("filtered payload = %s, want one model", filtered)
			}
		})
	}
}

func TestModelAllowedByContextMatchesProviderPathSuffix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(nil)
	context.Set(AllowedModelsContextKey, map[string]struct{}{"anthropic/claude-sonnet-4": {}})
	if !ModelAllowedByContext(context, "claude-sonnet-4") {
		t.Fatal("provider-prefixed allow-list must match the bare model ID")
	}
	if ModelAllowedByContext(context, "claude-opus-4") {
		t.Fatal("unrelated model must stay denied")
	}
}

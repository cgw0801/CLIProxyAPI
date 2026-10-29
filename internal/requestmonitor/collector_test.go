package requestmonitor

import (
	"context"
	"strings"
	"testing"
	"time"

	internallogging "github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func TestBuildEventMapsUsageRecord(t *testing.T) {
	ctx := internallogging.WithEndpoint(context.Background(), "POST /v1/chat/completions")
	ctx = internallogging.WithResponseStatusHolder(ctx)
	internallogging.SetResponseStatus(ctx, 200)
	ctx = internallogging.WithClientRequestMetadata(ctx, internallogging.ClientRequestMetadata{
		ClientIP:  "127.0.0.1",
		UserAgent: "test-agent",
	})
	record := coreusage.Record{
		RequestID:   "req-1",
		TraceID:     "trace-1",
		Provider:    "openai",
		Model:       "gpt-5",
		Alias:       "fast",
		AuthIndex:   "auth-1",
		AuthType:    "oauth",
		APIKey:      "sk-cpa-1234567890abcdef",
		RequestedAt: time.Now().UTC(),
		Latency:     1500 * time.Millisecond,
		TTFT:        500 * time.Millisecond,
		Stream:      true,
		Detail:      coreusage.Detail{InputTokens: 100, OutputTokens: 50, TotalTokens: 150},
		Generate:    coreusage.GenerateFlag(true),
	}
	event := buildEvent(ctx, record)
	if event.Provider != "openai" || event.Model != "gpt-5" || event.Alias != "fast" {
		t.Fatalf("unexpected identity: %+v", event)
	}
	if event.StatusCode != 200 || event.Failed {
		t.Fatalf("unexpected status: %+v", event)
	}
	if event.TotalTokens != 150 || event.TokensPerSecond != 50 {
		t.Fatalf("unexpected token metrics: %+v", event)
	}
	if event.APIKeyHash == "" || strings.Contains(event.APIKeyMasked, "1234567890abcdef") {
		t.Fatalf("api key was not redacted: hash=%q mask=%q", event.APIKeyHash, event.APIKeyMasked)
	}
	if event.Endpoint != "POST /v1/chat/completions" || event.ClientIP != "127.0.0.1" {
		t.Fatalf("unexpected request metadata: %+v", event)
	}
}

func TestBuildEventRedactsFailure(t *testing.T) {
	record := coreusage.Record{
		Provider: "claude",
		Model:    "sonnet",
		Failed:   true,
		Fail: coreusage.Failure{
			StatusCode: 401,
			Body:       `{"error":{"message":"bad key sk-secret-1234567890 for Bearer abcdefghijklmnop"}}`,
		},
	}
	event := buildEvent(context.Background(), record)
	if !event.Failed || event.StatusCode != 401 {
		t.Fatalf("unexpected failure state: %+v", event)
	}
	if strings.Contains(event.FailureSummary, "sk-secret") || strings.Contains(event.FailureSummary, "abcdefghijklmnop") {
		t.Fatalf("failure summary leaked a secret: %q", event.FailureSummary)
	}
	if !strings.Contains(event.FailureSummary, "[REDACTED]") {
		t.Fatalf("failure summary was not redacted: %q", event.FailureSummary)
	}
}

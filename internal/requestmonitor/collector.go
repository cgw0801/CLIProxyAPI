package requestmonitor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	internallogging "github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	"github.com/tidwall/gjson"
)

const collectorName = "request-monitor"

var (
	defaultMu    sync.RWMutex
	defaultStore *Store

	bearerTokenPattern = regexp.MustCompile(`(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}`)
	secretValuePattern = regexp.MustCompile(`(?i)("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)"?\s*[:=]\s*"?)[^"\s,}]+`)
	skKeyPattern       = regexp.MustCompile(`(?i)\bsk-[A-Za-z0-9_-]{6,}\b`)
)

func init() {
	coreusage.RegisterNamedPlugin(collectorName, &usageCollector{})
}

// Configure points the collector at a persistent directory. Calling it again
// replaces the previous store, which is useful for tests and embedded servers.
func Configure(dir string) error {
	store, errCreate := NewStore(dir, DefaultMaxEvents)
	if errCreate != nil {
		return errCreate
	}
	defaultMu.Lock()
	previous := defaultStore
	defaultStore = store
	defaultMu.Unlock()
	if previous != nil {
		previous.Close()
	}
	return nil
}

// Default returns the process-wide request monitor store.
func Default() *Store {
	defaultMu.RLock()
	store := defaultStore
	defaultMu.RUnlock()
	if store != nil {
		return store
	}
	defaultMu.Lock()
	defer defaultMu.Unlock()
	if defaultStore == nil {
		created, errCreate := NewStore("", DefaultMaxEvents)
		if errCreate != nil {
			return nil
		}
		defaultStore = created
	}
	return defaultStore
}

type usageCollector struct{}

func (c *usageCollector) HandleUsage(ctx context.Context, record coreusage.Record) {
	if c == nil {
		return
	}
	event := buildEvent(ctx, record)
	store := Default()
	if store == nil {
		return
	}
	store.Add(event)
}

func buildEvent(ctx context.Context, record coreusage.Record) Event {
	timestamp := record.RequestedAt
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}

	modelName := strings.TrimSpace(record.Model)
	if modelName == "" {
		modelName = "unknown"
	}
	aliasName := strings.TrimSpace(record.Alias)
	if aliasName == "" {
		aliasName = modelName
	}
	provider := strings.TrimSpace(record.Provider)
	if provider == "" {
		provider = "unknown"
	}

	metadata := internallogging.GetClientRequestMetadata(ctx)
	statusCode := record.Fail.StatusCode
	if statusCode <= 0 {
		statusCode = internallogging.GetResponseStatus(ctx)
	}
	failed := record.Failed || statusCode >= http.StatusBadRequest
	if statusCode <= 0 {
		if failed {
			statusCode = http.StatusInternalServerError
		} else {
			statusCode = http.StatusOK
		}
	}

	detail := coreusage.EnsureTokenBreakdownForProvider(record.Detail, record.Provider, record.ExecutorType)
	totalTokens := detail.TotalTokens
	if totalTokens == 0 {
		totalTokens = detail.TokenBreakdown.TotalTokens
	}
	latencyMs := record.Latency.Milliseconds()
	if latencyMs < 0 {
		latencyMs = 0
	}
	ttftMs := record.TTFT.Milliseconds()
	if ttftMs < 0 {
		ttftMs = 0
	}

	apiKey := strings.TrimSpace(record.APIKey)
	event := Event{
		Timestamp:           timestamp.UTC(),
		RequestID:           strings.TrimSpace(record.RequestID),
		TraceID:             firstNonEmpty(record.TraceID, internallogging.GetRequestID(ctx)),
		Provider:            provider,
		Model:               modelName,
		Alias:               aliasName,
		ResponseModel:       strings.TrimSpace(record.ResponseModel),
		Endpoint:            strings.TrimSpace(internallogging.GetEndpoint(ctx)),
		AuthID:              strings.TrimSpace(record.AuthID),
		AuthIndex:           strings.TrimSpace(record.AuthIndex),
		AuthType:            strings.TrimSpace(record.AuthType),
		APIKeyHash:          hashAPIKey(apiKey),
		APIKeyMasked:        maskAPIKey(apiKey),
		ClientIP:            firstNonEmpty(metadata.ResolvedClientIP, metadata.ClientIP),
		UserAgent:           strings.TrimSpace(metadata.UserAgent),
		Source:              strings.TrimSpace(record.Source),
		ExecutorType:        strings.TrimSpace(record.ExecutorType),
		ReasoningEffort:     firstNonEmpty(record.ReasoningEffort, coreusage.ReasoningEffortFromContext(ctx)),
		ServiceTier:         firstNonEmpty(record.ServiceTier, record.RequestServiceTier, coreusage.ServiceTierFromContext(ctx)),
		StatusCode:          statusCode,
		Failed:              failed,
		LatencyMs:           latencyMs,
		TTFTMs:              ttftMs,
		Stream:              record.Stream || coreusage.StreamFromContext(ctx),
		Generate:            coreusage.GenerateEnabled(record.Generate),
		InputTokens:         detail.InputTokens,
		OutputTokens:        detail.OutputTokens,
		ReasoningTokens:     detail.ReasoningTokens,
		CachedTokens:        detail.CachedTokens,
		CacheReadTokens:     detail.CacheReadTokens,
		CacheCreationTokens: detail.CacheCreationTokens,
		TotalTokens:         totalTokens,
	}
	if failed {
		event.FailureSummary = summarizeFailure(record.Fail.Body, statusCode)
	}
	event.TokensPerSecond = tokensPerSecond(event.OutputTokens, latencyMs, ttftMs, event.Stream)
	return event
}

func tokensPerSecond(outputTokens, latencyMs, ttftMs int64, stream bool) float64 {
	if outputTokens <= 0 || latencyMs <= 0 {
		return 0
	}
	generationMs := latencyMs
	if stream && ttftMs > 0 && latencyMs > ttftMs {
		generationMs = latencyMs - ttftMs
	}
	value := float64(outputTokens) / (float64(generationMs) / 1000)
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return math.Round(value*10) / 10
}

func hashAPIKey(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// HashAPIKey returns the SHA-256 hex digest used to identify a caller key without storing it.
func HashAPIKey(value string) string {
	return hashAPIKey(value)
}

func maskAPIKey(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= 12 {
		return "••••"
	}
	return string(runes[:6]) + "…" + string(runes[len(runes)-4:])
}

func summarizeFailure(body string, statusCode int) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return "HTTP " + http.StatusText(statusCode)
	}
	if gjson.Valid(body) {
		for _, path := range []string{"error.message", "message", "error_description", "detail", "error"} {
			result := gjson.Get(body, path)
			if result.Exists() && result.Type == gjson.String {
				if value := strings.TrimSpace(result.String()); value != "" {
					body = value
					break
				}
			}
		}
	}
	body = strings.Join(strings.Fields(body), " ")
	body = bearerTokenPattern.ReplaceAllString(body, "${1}[REDACTED]")
	body = secretValuePattern.ReplaceAllString(body, "${1}[REDACTED]")
	body = skKeyPattern.ReplaceAllString(body, "[REDACTED]")
	return truncateRunes(body, 240)
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

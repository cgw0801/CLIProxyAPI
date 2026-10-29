package requestmonitor

import "time"

// Event is a redacted, persistent record of one upstream model attempt.
type Event struct {
	ID                  int64     `json:"id"`
	Timestamp           time.Time `json:"timestamp"`
	RequestID           string    `json:"request_id,omitempty"`
	TraceID             string    `json:"trace_id,omitempty"`
	Provider            string    `json:"provider"`
	Model               string    `json:"model"`
	Alias               string    `json:"alias,omitempty"`
	ResponseModel       string    `json:"response_model,omitempty"`
	Endpoint            string    `json:"endpoint,omitempty"`
	AuthID              string    `json:"auth_id,omitempty"`
	AuthIndex           string    `json:"auth_index,omitempty"`
	AuthType            string    `json:"auth_type,omitempty"`
	APIKeyHash          string    `json:"api_key_hash,omitempty"`
	APIKeyMasked        string    `json:"api_key_masked,omitempty"`
	ClientIP            string    `json:"client_ip,omitempty"`
	UserAgent           string    `json:"user_agent,omitempty"`
	Source              string    `json:"source,omitempty"`
	ExecutorType        string    `json:"executor_type,omitempty"`
	ReasoningEffort     string    `json:"reasoning_effort,omitempty"`
	ServiceTier         string    `json:"service_tier,omitempty"`
	StatusCode          int       `json:"status_code"`
	Failed              bool      `json:"failed"`
	FailureSummary      string    `json:"failure_summary,omitempty"`
	LatencyMs           int64     `json:"latency_ms"`
	TTFTMs              int64     `json:"ttft_ms,omitempty"`
	TokensPerSecond     float64   `json:"tokens_per_second,omitempty"`
	Stream              bool      `json:"stream"`
	Generate            bool      `json:"generate"`
	InputTokens         int64     `json:"input_tokens"`
	OutputTokens        int64     `json:"output_tokens"`
	ReasoningTokens     int64     `json:"reasoning_tokens"`
	CachedTokens        int64     `json:"cached_tokens"`
	CacheReadTokens     int64     `json:"cache_read_tokens"`
	CacheCreationTokens int64     `json:"cache_creation_tokens"`
	TotalTokens         int64     `json:"total_tokens"`
}

// Summary aggregates all events matching a filter.
type Summary struct {
	Requests            int64   `json:"requests"`
	Success             int64   `json:"success"`
	Failed              int64   `json:"failed"`
	SuccessRate         float64 `json:"success_rate"`
	AverageLatencyMs    float64 `json:"average_latency_ms"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	ReasoningTokens     int64   `json:"reasoning_tokens"`
	CachedTokens        int64   `json:"cached_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
	CacheCreationTokens int64   `json:"cache_creation_tokens"`
	TotalTokens         int64   `json:"total_tokens"`
	StreamRequests      int64   `json:"stream_requests"`
}

// GroupSummary aggregates events for one account or one caller API key.
type GroupSummary struct {
	Key              string    `json:"key"`
	Label            string    `json:"label,omitempty"`
	Detail           string    `json:"detail,omitempty"`
	Requests         int64     `json:"requests"`
	Success          int64     `json:"success"`
	Failed           int64     `json:"failed"`
	SuccessRate      float64   `json:"success_rate"`
	AverageLatencyMs float64   `json:"average_latency_ms"`
	TotalTokens      int64     `json:"total_tokens"`
	LastSeen         time.Time `json:"last_seen"`
}

// Option is a selectable filter value with its event count.
type Option struct {
	Value string `json:"value"`
	Label string `json:"label,omitempty"`
	Count int64  `json:"count"`
}

// Options contains distinct filter values across retained events.
type Options struct {
	Providers []Option `json:"providers"`
	Models    []Option `json:"models"`
	Accounts  []Option `json:"accounts"`
	APIKeys   []Option `json:"api_keys"`
}

// QueryOptions selects a page of events and computes aggregate data.
type QueryOptions struct {
	Since      time.Time
	Provider   string
	Model      string
	Account    string
	APIKeyHash string
	Status     string
	Search     string
	Limit      int
	Page       int
	Offset     int
	BeforeID   int64
}

// QueryResult is the payload used by the monitoring API.
type QueryResult struct {
	Events     []Event        `json:"events"`
	Total      int            `json:"total"`
	HasMore    bool           `json:"has_more"`
	Summary    Summary        `json:"summary"`
	Accounts   []GroupSummary `json:"accounts"`
	APIKeys    []GroupSummary `json:"api_keys"`
	Options    Options        `json:"options"`
	Retained   int            `json:"retained"`
	MaxEvents  int            `json:"max_events"`
	Persistent bool           `json:"persistent"`
}

package requestmonitor

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"
)

const (
	// DefaultMaxEvents bounds the in-memory history and the on-disk journal.
	DefaultMaxEvents  = 20000
	defaultQueryLimit = 100
	maxQueryLimit     = 500
	maxJournalBytes   = 32 << 20
)

// Store keeps recent request events in memory and appends them to a JSONL file.
type Store struct {
	mu             sync.RWMutex
	events         []Event
	nextID         int64
	maxEvents      int
	path           string
	file           *os.File
	fileSize       int64
	bytesSinceSync int64
}

// NewStore creates a store rooted at dir. An empty dir keeps the store in memory.
func NewStore(dir string, maxEvents int) (*Store, error) {
	if maxEvents <= 0 {
		maxEvents = DefaultMaxEvents
	}
	s := &Store{
		maxEvents: maxEvents,
		nextID:    1,
	}
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return s, nil
	}
	if errMkdir := os.MkdirAll(dir, 0o755); errMkdir != nil {
		return nil, fmt.Errorf("create request monitor directory: %w", errMkdir)
	}
	s.path = filepath.Join(dir, "requests.jsonl")
	loaded, errLoad := loadEvents(s.path, maxEvents)
	if errLoad != nil {
		return nil, errLoad
	}
	s.events = loaded
	if len(s.events) > 0 {
		s.nextID = s.events[len(s.events)-1].ID + 1
	}
	file, errOpen := os.OpenFile(s.path, os.O_CREATE|os.O_RDWR, 0o644)
	if errOpen != nil {
		return nil, fmt.Errorf("open request monitor journal: %w", errOpen)
	}
	s.file = file
	if stat, errStat := file.Stat(); errStat == nil {
		s.fileSize = stat.Size()
	}
	// A journal can contain more rows than the retained memory after a previous
	// run. Rewriting it keeps startup bounded and removes corrupt lines.
	if len(loaded) >= maxEvents {
		s.rewriteLocked()
	}
	return s, nil
}

func loadEvents(path string, maxEvents int) ([]Event, error) {
	file, errOpen := os.Open(path)
	if errOpen != nil {
		if os.IsNotExist(errOpen) {
			return nil, nil
		}
		return nil, fmt.Errorf("read request monitor journal: %w", errOpen)
	}
	defer func() {
		if errClose := file.Close(); errClose != nil {
			log.WithError(errClose).Warn("request monitor: close journal after load")
		}
	}()

	events := make([]Event, 0, 256)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event Event
		if errUnmarshal := json.Unmarshal([]byte(line), &event); errUnmarshal != nil {
			log.WithError(errUnmarshal).Warn("request monitor: skip invalid journal line")
			continue
		}
		if event.ID <= 0 {
			event.ID = int64(len(events) + 1)
		}
		events = append(events, event)
	}
	if errScan := scanner.Err(); errScan != nil {
		return nil, fmt.Errorf("scan request monitor journal: %w", errScan)
	}
	if len(events) > maxEvents {
		events = append([]Event(nil), events[len(events)-maxEvents:]...)
	}
	return events, nil
}

// Add appends one event. The assigned ID and timestamp are returned to the caller.
func (s *Store) Add(event Event) Event {
	if s == nil {
		return event
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	event.ID = s.nextID
	s.nextID++
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	} else {
		event.Timestamp = event.Timestamp.UTC()
	}
	s.events = append(s.events, event)
	if len(s.events) > s.maxEvents {
		s.events = append([]Event(nil), s.events[len(s.events)-s.maxEvents:]...)
	}
	s.appendLocked(event)
	if s.file != nil && s.fileSize > maxJournalBytes {
		s.rewriteLocked()
	}
	return event
}

func (s *Store) appendLocked(event Event) {
	if s.file == nil {
		return
	}
	data, errMarshal := json.Marshal(event)
	if errMarshal != nil {
		log.WithError(errMarshal).Warn("request monitor: encode event")
		return
	}
	if _, errSeek := s.file.Seek(0, io.SeekEnd); errSeek != nil {
		log.WithError(errSeek).Warn("request monitor: seek journal")
		return
	}
	payload := append(data, '\n')
	written, errWrite := s.file.Write(payload)
	if errWrite != nil {
		log.WithError(errWrite).Warn("request monitor: append journal")
		return
	}
	s.fileSize += int64(written)
	s.bytesSinceSync += int64(written)
	if s.bytesSinceSync >= 64*1024 {
		if errSync := s.file.Sync(); errSync != nil {
			log.WithError(errSync).Warn("request monitor: sync journal")
		}
		s.bytesSinceSync = 0
	}
}

func (s *Store) rewriteLocked() {
	if s == nil || s.file == nil {
		return
	}
	if errTruncate := s.file.Truncate(0); errTruncate != nil {
		log.WithError(errTruncate).Warn("request monitor: truncate journal")
		return
	}
	if _, errSeek := s.file.Seek(0, io.SeekStart); errSeek != nil {
		log.WithError(errSeek).Warn("request monitor: seek journal for rewrite")
		return
	}
	writer := bufio.NewWriter(s.file)
	for _, event := range s.events {
		data, errMarshal := json.Marshal(event)
		if errMarshal != nil {
			continue
		}
		if _, errWrite := writer.Write(append(data, '\n')); errWrite != nil {
			log.WithError(errWrite).Warn("request monitor: rewrite journal")
			return
		}
	}
	if errFlush := writer.Flush(); errFlush != nil {
		log.WithError(errFlush).Warn("request monitor: flush journal")
		return
	}
	if errSync := s.file.Sync(); errSync != nil {
		log.WithError(errSync).Warn("request monitor: sync rewritten journal")
	}
	if stat, errStat := s.file.Stat(); errStat == nil {
		s.fileSize = stat.Size()
	}
	s.bytesSinceSync = 0
}

// Clear removes all retained events and truncates the journal.
func (s *Store) Clear() int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	count := len(s.events)
	s.events = nil
	s.nextID = 1
	if s.file != nil {
		if errTruncate := s.file.Truncate(0); errTruncate != nil {
			log.WithError(errTruncate).Warn("request monitor: truncate journal on clear")
		} else {
			s.fileSize = 0
			s.bytesSinceSync = 0
		}
	}
	return count
}

// Close releases the journal file handle.
func (s *Store) Close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file == nil {
		return
	}
	if errSync := s.file.Sync(); errSync != nil {
		log.WithError(errSync).Warn("request monitor: sync journal before close")
	}
	if errClose := s.file.Close(); errClose != nil {
		log.WithError(errClose).Warn("request monitor: close journal")
	}
	s.file = nil
}

// Query returns a page of events together with aggregates for all matching events.
func (s *Store) Query(opts QueryOptions) QueryResult {
	if s == nil {
		return QueryResult{}
	}
	if opts.Limit <= 0 {
		opts.Limit = defaultQueryLimit
	}
	if opts.Limit > maxQueryLimit {
		opts.Limit = maxQueryLimit
	}
	if opts.Page <= 0 {
		opts.Page = 1
	}
	if opts.Offset < 0 {
		opts.Offset = 0
	}
	if opts.Offset == 0 && opts.Page > 1 {
		opts.Offset = (opts.Page - 1) * opts.Limit
	}
	search := strings.ToLower(strings.TrimSpace(opts.Search))

	s.mu.RLock()
	defer s.mu.RUnlock()

	result := QueryResult{
		Events:     make([]Event, 0, opts.Limit),
		Retained:   len(s.events),
		MaxEvents:  s.maxEvents,
		Persistent: s.path != "",
	}
	result.Options = s.optionsLocked()

	latencyTotal := int64(0)
	accountGroups := make(map[string]*GroupSummary)
	apiKeyGroups := make(map[string]*GroupSummary)
	matched := 0

	for i := len(s.events) - 1; i >= 0; i-- {
		event := &s.events[i]
		if !matchesQuery(event, opts, search) {
			continue
		}
		result.Total++
		addSummary(&result.Summary, event, &latencyTotal)
		addGroup(accountGroups, accountKey(*event), event)
		addGroup(apiKeyGroups, apiKeyKey(*event), event)

		if opts.BeforeID > 0 && event.ID >= opts.BeforeID {
			continue
		}
		if matched < opts.Offset {
			matched++
			continue
		}
		if len(result.Events) < opts.Limit {
			result.Events = append(result.Events, *event)
			matched++
			continue
		}
		result.HasMore = true
	}
	finalizeSummary(&result.Summary, latencyTotal)
	result.Accounts = finalizeGroups(accountGroups)
	result.APIKeys = finalizeGroups(apiKeyGroups)
	return result
}

func matchesQuery(event *Event, opts QueryOptions, search string) bool {
	if event == nil {
		return false
	}
	if !opts.Since.IsZero() && event.Timestamp.Before(opts.Since) {
		return false
	}
	if provider := strings.TrimSpace(opts.Provider); provider != "" && !strings.EqualFold(event.Provider, provider) {
		return false
	}
	if model := strings.TrimSpace(opts.Model); model != "" &&
		!strings.EqualFold(event.Model, model) && !strings.EqualFold(event.Alias, model) {
		return false
	}
	if account := strings.TrimSpace(opts.Account); account != "" {
		key := accountKey(*event)
		if !strings.EqualFold(key, account) {
			return false
		}
	}
	if apiKeyHash := strings.TrimSpace(opts.APIKeyHash); apiKeyHash != "" && !strings.EqualFold(event.APIKeyHash, apiKeyHash) {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(opts.Status)) {
	case "failed", "failure", "error":
		if !event.Failed {
			return false
		}
	case "success", "succeeded", "ok":
		if event.Failed {
			return false
		}
	}
	if search == "" {
		return true
	}
	haystack := strings.ToLower(strings.Join([]string{
		event.RequestID,
		event.TraceID,
		event.Provider,
		event.Model,
		event.Alias,
		event.ResponseModel,
		event.Endpoint,
		event.AuthID,
		event.AuthIndex,
		event.APIKeyMasked,
		event.FailureSummary,
		event.ClientIP,
		event.UserAgent,
	}, "\n"))
	return strings.Contains(haystack, search)
}

// AccountKey returns the stable account identifier used by the monitoring API.
func AccountKey(event Event) string {
	return accountKey(event)
}

func accountKey(event Event) string {
	if value := strings.TrimSpace(event.AuthIndex); value != "" {
		return value
	}
	if value := strings.TrimSpace(event.AuthID); value != "" {
		return value
	}
	return "unknown"
}

func apiKeyKey(event Event) string {
	if value := strings.TrimSpace(event.APIKeyHash); value != "" {
		return value
	}
	return "unknown"
}

func addSummary(summary *Summary, event *Event, latencyTotal *int64) {
	summary.Requests++
	if event.Failed {
		summary.Failed++
	} else {
		summary.Success++
	}
	if event.Stream {
		summary.StreamRequests++
	}
	*latencyTotal += event.LatencyMs
	summary.InputTokens += event.InputTokens
	summary.OutputTokens += event.OutputTokens
	summary.ReasoningTokens += event.ReasoningTokens
	summary.CachedTokens += event.CachedTokens
	summary.CacheReadTokens += event.CacheReadTokens
	summary.CacheCreationTokens += event.CacheCreationTokens
	summary.TotalTokens += event.TotalTokens
}

func finalizeSummary(summary *Summary, latencyTotal int64) {
	if summary.Requests > 0 {
		summary.SuccessRate = round(float64(summary.Success)/float64(summary.Requests)*100, 2)
		summary.AverageLatencyMs = round(float64(latencyTotal)/float64(summary.Requests), 1)
	}
}

func addGroup(groups map[string]*GroupSummary, key string, event *Event) {
	group := groups[key]
	if group == nil {
		group = &GroupSummary{Key: key, Label: key}
		groups[key] = group
	}
	group.Requests++
	if event.Failed {
		group.Failed++
	} else {
		group.Success++
	}
	group.TotalTokens += event.TotalTokens
	group.AverageLatencyMs += float64(event.LatencyMs)
	if event.Timestamp.After(group.LastSeen) {
		group.LastSeen = event.Timestamp
	}
}

func finalizeGroups(groups map[string]*GroupSummary) []GroupSummary {
	result := make([]GroupSummary, 0, len(groups))
	for _, group := range groups {
		if group.Requests > 0 {
			group.SuccessRate = round(float64(group.Success)/float64(group.Requests)*100, 2)
			group.AverageLatencyMs = round(group.AverageLatencyMs/float64(group.Requests), 1)
		}
		result = append(result, *group)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Requests != result[j].Requests {
			return result[i].Requests > result[j].Requests
		}
		return result[i].Key < result[j].Key
	})
	return result
}

func (s *Store) optionsLocked() Options {
	providerCounts := make(map[string]int64)
	modelCounts := make(map[string]int64)
	accountCounts := make(map[string]int64)
	apiKeyCounts := make(map[string]int64)
	for i := range s.events {
		event := &s.events[i]
		providerCounts[event.Provider]++
		model := strings.TrimSpace(event.Alias)
		if model == "" {
			model = strings.TrimSpace(event.Model)
		}
		modelCounts[model]++
		accountCounts[accountKey(*event)]++
		apiKeyCounts[apiKeyKey(*event)]++
	}
	return Options{
		Providers: optionList(providerCounts),
		Models:    optionList(modelCounts),
		Accounts:  optionList(accountCounts),
		APIKeys:   optionList(apiKeyCounts),
	}
}

func optionList(counts map[string]int64) []Option {
	result := make([]Option, 0, len(counts))
	for value, count := range counts {
		if strings.TrimSpace(value) == "" {
			continue
		}
		result = append(result, Option{Value: value, Label: value, Count: count})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Count != result[j].Count {
			return result[i].Count > result[j].Count
		}
		return result[i].Value < result[j].Value
	})
	return result
}

func round(value float64, digits int) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	factor := math.Pow10(digits)
	return math.Round(value*factor) / factor
}

package requestmonitor

import (
	"testing"
	"time"
)

func TestStoreQueryFiltersAndSummary(t *testing.T) {
	store, errCreate := NewStore("", 10)
	if errCreate != nil {
		t.Fatalf("NewStore: %v", errCreate)
	}
	t.Cleanup(store.Close)

	now := time.Now().UTC()
	store.Add(Event{
		Timestamp:    now.Add(-2 * time.Minute),
		Provider:     "openai",
		Model:        "gpt-5",
		Alias:        "fast",
		AuthIndex:    "auth-a",
		APIKeyHash:   "key-a",
		StatusCode:   200,
		LatencyMs:    120,
		InputTokens:  10,
		OutputTokens: 20,
		TotalTokens:  30,
	})
	store.Add(Event{
		Timestamp:      now.Add(-time.Minute),
		Provider:       "claude",
		Model:          "sonnet",
		AuthIndex:      "auth-b",
		APIKeyHash:     "key-b",
		StatusCode:     429,
		Failed:         true,
		FailureSummary: "rate limited",
		LatencyMs:      500,
		TotalTokens:    5,
	})

	result := store.Query(QueryOptions{Status: "failed"})
	if result.Total != 1 || len(result.Events) != 1 {
		t.Fatalf("expected one failed event, got total=%d page=%d", result.Total, len(result.Events))
	}
	if result.Summary.Failed != 1 || result.Summary.Success != 0 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	if result.Summary.SuccessRate != 0 {
		t.Fatalf("expected 0 success rate, got %v", result.Summary.SuccessRate)
	}
	if len(result.Accounts) != 1 || result.Accounts[0].Key != "auth-b" {
		t.Fatalf("unexpected account groups: %+v", result.Accounts)
	}

	result = store.Query(QueryOptions{Provider: "openai", Search: "fast"})
	if result.Total != 1 || result.Events[0].Model != "gpt-5" {
		t.Fatalf("unexpected search result: %+v", result)
	}
	if result.Summary.TotalTokens != 30 || result.Summary.AverageLatencyMs != 120 {
		t.Fatalf("unexpected aggregates: %+v", result.Summary)
	}
}

func TestStoreQueryModelOptionsPreferAlias(t *testing.T) {
	store, errCreate := NewStore("", 10)
	if errCreate != nil {
		t.Fatalf("NewStore: %v", errCreate)
	}
	t.Cleanup(store.Close)

	store.Add(Event{Provider: "openai-compatible", Model: "upstream-model", Alias: "client-model"})
	store.Add(Event{Provider: "openai-compatible", Model: "upstream-model", Alias: "client-model"})
	store.Add(Event{Provider: "openai-compatible", Model: "original-only"})

	result := store.Query(QueryOptions{Limit: 10})
	counts := make(map[string]int64, len(result.Options.Models))
	for _, option := range result.Options.Models {
		counts[option.Value] = option.Count
	}
	if counts["client-model"] != 2 || counts["original-only"] != 1 {
		t.Fatalf("unexpected model options: %+v", result.Options.Models)
	}
	if _, exists := counts["upstream-model"]; exists {
		t.Fatalf("aliased upstream model should not be listed: %+v", result.Options.Models)
	}

	filtered := store.Query(QueryOptions{Model: "client-model"})
	if filtered.Total != 2 {
		t.Fatalf("alias filter total = %d, want 2", filtered.Total)
	}
}

func TestStorePersistsAndCapsEvents(t *testing.T) {
	dir := t.TempDir()
	store, errCreate := NewStore(dir, 2)
	if errCreate != nil {
		t.Fatalf("NewStore: %v", errCreate)
	}
	store.Add(Event{Provider: "one", Model: "m1"})
	store.Add(Event{Provider: "two", Model: "m2"})
	store.Add(Event{Provider: "three", Model: "m3"})
	store.Close()

	reloaded, errReload := NewStore(dir, 2)
	if errReload != nil {
		t.Fatalf("reload NewStore: %v", errReload)
	}
	t.Cleanup(reloaded.Close)
	result := reloaded.Query(QueryOptions{Limit: 10})
	if result.Retained != 2 {
		t.Fatalf("expected 2 retained events, got %d", result.Retained)
	}
	if len(result.Events) != 2 || result.Events[0].Provider != "three" || result.Events[1].Provider != "two" {
		t.Fatalf("unexpected persisted order: %+v", result.Events)
	}
}

func TestStoreQueryPagination(t *testing.T) {
	store, errCreate := NewStore("", 10)
	if errCreate != nil {
		t.Fatalf("NewStore: %v", errCreate)
	}
	t.Cleanup(store.Close)

	for index := 0; index < 5; index++ {
		store.Add(Event{Provider: "provider", Model: "model", StatusCode: 200})
	}

	first := store.Query(QueryOptions{Page: 1, Limit: 2})
	if first.Total != 5 || len(first.Events) != 2 || first.Events[0].ID != 5 || first.Events[1].ID != 4 {
		t.Fatalf("unexpected first page: total=%d events=%+v", first.Total, first.Events)
	}
	if !first.HasMore {
		t.Fatal("first page should report more events")
	}

	second := store.Query(QueryOptions{Page: 2, Limit: 2})
	if len(second.Events) != 2 || second.Events[0].ID != 3 || second.Events[1].ID != 2 {
		t.Fatalf("unexpected second page: %+v", second.Events)
	}
	if !second.HasMore {
		t.Fatal("second page should report more events")
	}

	last := store.Query(QueryOptions{Page: 3, Limit: 2})
	if len(last.Events) != 1 || last.Events[0].ID != 1 || last.HasMore {
		t.Fatalf("unexpected last page: events=%+v hasMore=%v", last.Events, last.HasMore)
	}
}

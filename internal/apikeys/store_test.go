package apikeys

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestStoreSeedsLegacyKeysWithAllModelsWildcard(t *testing.T) {
	path := filepath.Join(t.TempDir(), "api-keys.json")
	store, errNew := New(path, []string{"sk-legacy"})
	if errNew != nil {
		t.Fatalf("New() error = %v", errNew)
	}

	keys := store.List()
	if len(keys) != 1 || keys[0].Key != "sk-legacy" {
		t.Fatalf("List() = %#v, want one seeded key", keys)
	}
	if len(keys[0].Models) != 1 || keys[0].Models[0] != "*" {
		t.Fatalf("seeded models = %#v, want wildcard", keys[0].Models)
	}

	encoded, errMarshal := json.Marshal(keys[0])
	if errMarshal != nil {
		t.Fatalf("Marshal() error = %v", errMarshal)
	}
	var decoded struct {
		Models json.RawMessage `json:"models"`
	}
	if errUnmarshal := json.Unmarshal(encoded, &decoded); errUnmarshal != nil {
		t.Fatalf("Unmarshal() error = %v", errUnmarshal)
	}
	if string(decoded.Models) != "[\"*\"]" {
		t.Fatalf("models = %s, want wildcard", decoded.Models)
	}
}

func TestStoreCreateUpdateDeletePersistsModelAllowList(t *testing.T) {
	path := filepath.Join(t.TempDir(), "api-keys.json")
	store, errNew := New(path, nil)
	if errNew != nil {
		t.Fatalf("New() error = %v", errNew)
	}

	created, errCreate := store.Create("client", "sk-client", []string{"gpt-5", "claude-sonnet-4"})
	if errCreate != nil {
		t.Fatalf("Create() error = %v", errCreate)
	}
	if len(created.Models) != 2 {
		t.Fatalf("created models = %#v, want two entries", created.Models)
	}

	if _, errDuplicate := store.Create("duplicate", "sk-client", nil); !errors.Is(errDuplicate, ErrDuplicateKey) {
		t.Fatalf("Create() duplicate error = %v, want ErrDuplicateKey", errDuplicate)
	}

	updated, errUpdate := store.Update(created.ID, "renamed", "sk-client", []string{"gpt-5"})
	if errUpdate != nil {
		t.Fatalf("Update() error = %v", errUpdate)
	}
	if updated.Name != "renamed" || len(updated.Models) != 1 || updated.Models[0] != "gpt-5" {
		t.Fatalf("updated key = %#v", updated)
	}

	reloaded, errReload := New(path, nil)
	if errReload != nil {
		t.Fatalf("New(reload) error = %v", errReload)
	}
	keys := reloaded.List()
	if len(keys) != 1 || keys[0].Name != "renamed" || len(keys[0].Models) != 1 {
		t.Fatalf("reloaded keys = %#v", keys)
	}

	if errDelete := reloaded.Delete(created.ID); errDelete != nil {
		t.Fatalf("Delete() error = %v", errDelete)
	}
	if _, errRead := os.Stat(path); errRead != nil {
		t.Fatalf("store file missing after delete: %v", errRead)
	}
	if len(reloaded.List()) != 0 {
		t.Fatal("Delete() did not remove the key")
	}
}

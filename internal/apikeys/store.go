// Package apikeys manages client API keys and their model access policies.
package apikeys

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const fileVersion = 1

var (
	ErrDuplicateKey = errors.New("api key already exists")
	ErrNotFound     = errors.New("api key not found")
	ErrEmptyKey     = errors.New("api key must not be empty")
)

// Key describes one client API key and its model allow-list.
// An empty Models slice grants access to no models. The wildcard "*" grants
// access to every available model.
type Key struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Key    string   `json:"key"`
	Models []string `json:"models"`
}

type fileData struct {
	Version int   `json:"version"`
	Keys    []Key `json:"keys"`
}

// Store keeps API keys in memory and persists them as a standalone JSON file.
type Store struct {
	mu   sync.RWMutex
	path string
	keys []Key
}

// New creates a store at path. When the file does not exist, seed keys are
// imported from the legacy config list and written to the new file.
func New(path string, seed []string) (*Store, error) {
	store := &Store{path: strings.TrimSpace(path)}
	if store.path == "" {
		store.keys = seedKeys(seed)
		return store, nil
	}
	data, errRead := os.ReadFile(store.path)
	if errRead == nil {
		var payload fileData
		if errUnmarshal := json.Unmarshal(data, &payload); errUnmarshal != nil {
			return nil, fmt.Errorf("parse api key store: %w", errUnmarshal)
		}
		normalized, errNormalize := normalizeKeys(payload.Keys)
		if errNormalize != nil {
			return nil, errNormalize
		}
		store.keys = normalized
		return store, nil
	}
	if !errors.Is(errRead, os.ErrNotExist) {
		return nil, fmt.Errorf("read api key store: %w", errRead)
	}
	store.keys = seedKeys(seed)
	if errWrite := store.saveLocked(); errWrite != nil {
		return nil, errWrite
	}
	return store, nil
}

// NewMemory creates a store that is not persisted to disk.
func NewMemory(seed []string) *Store {
	return &Store{keys: seedKeys(seed)}
}

// List returns a copy of all keys.
func (s *Store) List() []Key {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Key, len(s.keys))
	for i, key := range s.keys {
		out[i] = cloneKey(key)
	}
	return out
}

// Count returns the number of configured keys.
func (s *Store) Count() int {
	if s == nil {
		return 0
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.keys)
}

// FindByKey returns the key record matching the provided secret.
func (s *Store) FindByKey(secret string) (Key, bool) {
	if s == nil {
		return Key{}, false
	}
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return Key{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, key := range s.keys {
		if key.Key == secret {
			return cloneKey(key), true
		}
	}
	return Key{}, false
}

// HasKey reports whether the provided secret belongs to a configured key.
func (s *Store) HasKey(secret string) bool {
	_, ok := s.FindByKey(secret)
	return ok
}

// Create adds a new key and persists the change.
func (s *Store) Create(name, secret string, models []string) (Key, error) {
	if s == nil {
		return Key{}, errors.New("api key store is unavailable")
	}
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return Key{}, ErrEmptyKey
	}
	models = normalizeModels(models)

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.hasSecretLocked(secret, "") {
		return Key{}, ErrDuplicateKey
	}
	key := Key{
		ID:     s.nextIDLocked(),
		Name:   defaultName(name, len(s.keys)+1),
		Key:    secret,
		Models: models,
	}
	next := append(cloneKeys(s.keys), key)
	if errSave := s.replaceLocked(next); errSave != nil {
		return Key{}, errSave
	}
	return cloneKey(key), nil
}

// Update replaces the editable fields of an existing key.
func (s *Store) Update(id, name, secret string, models []string) (Key, error) {
	if s == nil {
		return Key{}, errors.New("api key store is unavailable")
	}
	id = strings.TrimSpace(id)
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return Key{}, ErrEmptyKey
	}
	models = normalizeModels(models)

	s.mu.Lock()
	defer s.mu.Unlock()
	index := -1
	for i, key := range s.keys {
		if key.ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return Key{}, ErrNotFound
	}
	if s.hasSecretLocked(secret, id) {
		return Key{}, ErrDuplicateKey
	}
	updated := Key{ID: id, Name: defaultName(name, index+1), Key: secret, Models: models}
	next := cloneKeys(s.keys)
	next[index] = updated
	if errSave := s.replaceLocked(next); errSave != nil {
		return Key{}, errSave
	}
	return cloneKey(updated), nil
}

// Delete removes a key by ID.
func (s *Store) Delete(id string) error {
	if s == nil {
		return errors.New("api key store is unavailable")
	}
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make([]Key, 0, len(s.keys))
	found := false
	for _, key := range s.keys {
		if key.ID == id {
			found = true
			continue
		}
		next = append(next, key)
	}
	if !found {
		return ErrNotFound
	}
	return s.replaceLocked(next)
}

func (s *Store) hasSecretLocked(secret, exceptID string) bool {
	for _, key := range s.keys {
		if key.ID != exceptID && key.Key == secret {
			return true
		}
	}
	return false
}

func (s *Store) nextIDLocked() string {
	for {
		var random [8]byte
		if _, errRead := rand.Read(random[:]); errRead != nil {
			return fmt.Sprintf("key-%d", len(s.keys)+1)
		}
		id := "key-" + hex.EncodeToString(random[:])
		exists := false
		for _, key := range s.keys {
			if key.ID == id {
				exists = true
				break
			}
		}
		if !exists {
			return id
		}
	}
}

func (s *Store) replaceLocked(next []Key) error {
	previous := s.keys
	s.keys = cloneKeys(next)
	if errSave := s.saveLocked(); errSave != nil {
		s.keys = previous
		return errSave
	}
	return nil
}

func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}
	data, errMarshal := json.MarshalIndent(fileData{Version: fileVersion, Keys: s.keys}, "", "  ")
	if errMarshal != nil {
		return fmt.Errorf("encode api key store: %w", errMarshal)
	}
	data = append(data, '\n')
	dir := filepath.Dir(s.path)
	if errMkdir := os.MkdirAll(dir, 0o700); errMkdir != nil {
		return fmt.Errorf("create api key directory: %w", errMkdir)
	}
	temp, errCreate := os.CreateTemp(dir, ".api-keys-*.tmp")
	if errCreate != nil {
		return fmt.Errorf("create api key temp file: %w", errCreate)
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if errChmod := temp.Chmod(0o600); errChmod != nil {
		_ = temp.Close()
		return fmt.Errorf("set api key file permissions: %w", errChmod)
	}
	if _, errWrite := temp.Write(data); errWrite != nil {
		_ = temp.Close()
		return fmt.Errorf("write api key store: %w", errWrite)
	}
	if errSync := temp.Sync(); errSync != nil {
		_ = temp.Close()
		return fmt.Errorf("sync api key store: %w", errSync)
	}
	if errClose := temp.Close(); errClose != nil {
		return fmt.Errorf("close api key store: %w", errClose)
	}
	if errRename := os.Rename(tempPath, s.path); errRename != nil {
		return fmt.Errorf("replace api key store: %w", errRename)
	}
	return nil
}

func normalizeKeys(keys []Key) ([]Key, error) {
	normalized := make([]Key, 0, len(keys))
	seenSecrets := make(map[string]struct{}, len(keys))
	seenIDs := make(map[string]struct{}, len(keys))
	for index, key := range keys {
		secret := strings.TrimSpace(key.Key)
		if secret == "" {
			continue
		}
		if _, exists := seenSecrets[secret]; exists {
			return nil, ErrDuplicateKey
		}
		seenSecrets[secret] = struct{}{}
		id := strings.TrimSpace(key.ID)
		if _, exists := seenIDs[id]; id == "" || exists {
			id = fmt.Sprintf("key-%d", index+1)
			for suffix := 2; ; suffix++ {
				if _, exists := seenIDs[id]; !exists {
					break
				}
				id = fmt.Sprintf("key-%d-%d", index+1, suffix)
			}
		}
		seenIDs[id] = struct{}{}
		normalized = append(normalized, Key{
			ID:     id,
			Name:   defaultName(key.Name, index+1),
			Key:    secret,
			Models: normalizeModels(key.Models),
		})
	}
	sort.SliceStable(normalized, func(i, j int) bool { return normalized[i].ID < normalized[j].ID })
	return normalized, nil
}

func seedKeys(seeds []string) []Key {
	keys := make([]Key, 0, len(seeds))
	seen := make(map[string]struct{}, len(seeds))
	for _, seed := range seeds {
		secret := strings.TrimSpace(seed)
		if secret == "" {
			continue
		}
		if _, exists := seen[secret]; exists {
			continue
		}
		seen[secret] = struct{}{}
		index := len(keys) + 1
		keys = append(keys, Key{
			ID:     fmt.Sprintf("key-%d", index),
			Name:   fmt.Sprintf("Key %d", index),
			Key:    secret,
			Models: []string{"*"},
		})
	}
	return keys
}

func normalizeModels(models []string) []string {
	if len(models) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(models))
	out := make([]string, 0, len(models))
	for _, model := range models {
		name := strings.TrimSpace(model)
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func defaultName(name string, index int) string {
	name = strings.TrimSpace(name)
	if name != "" {
		return name
	}
	return fmt.Sprintf("Key %d", index)
}

func cloneKey(key Key) Key {
	models := make([]string, len(key.Models))
	copy(models, key.Models)
	key.Models = models
	return key
}

func cloneKeys(keys []Key) []Key {
	out := make([]Key, len(keys))
	for i, key := range keys {
		out[i] = cloneKey(key)
	}
	return out
}

package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestSaveConfigPreserveCommentsKeepsModelACLObjects(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	src := []byte("# keep me\nport: 8317\napi-keys:\n  - unrestricted\n  - key: limited\n    models: [model-b, model-a]\ndebug: false\n")
	if errWrite := os.WriteFile(path, src, 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
	cfg, errLoad := LoadConfig(path)
	if errLoad != nil {
		t.Fatal(errLoad)
	}
	cfg.Debug = true
	if errSave := SaveConfigPreserveComments(path, cfg); errSave != nil {
		t.Fatal(errSave)
	}

	saved, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatal(errRead)
	}
	text := string(saved)
	for _, want := range []string{"# keep me", "key: limited", "models:", "- model-a", "- model-b", "- unrestricted"} {
		if !strings.Contains(text, want) {
			t.Fatalf("saved config missing %q:\n%s", want, text)
		}
	}
	reloaded, errReload := LoadConfig(path)
	if errReload != nil {
		t.Fatal(errReload)
	}
	if !reloaded.ModelACL.Allowed("limited", "model-a") || reloaded.ModelACL.Allowed("limited", "model-c") {
		t.Fatalf("reloaded ACL = %#v", reloaded.ModelACL)
	}
}

func TestExtractModelACLMixedForms(t *testing.T) {
	src := []byte(`
port: 8317
api-keys:
  - plain-key
  - key: limited-key
    models:
      - deepseek-v4-pro
      - 牛来
  - key: wildcard-key
    models: ["*"]
debug: false
`)

	acl, rewritten, err := ExtractModelACL(src)
	if err != nil {
		t.Fatalf("ExtractModelACL: %v", err)
	}

	// The rewritten YAML must present api-keys as a plain []string so the
	// upstream struct tag keeps working untouched.
	var probe struct {
		APIKeys []string `yaml:"api-keys"`
		Port    int      `yaml:"port"`
	}
	if err := yaml.Unmarshal(rewritten, &probe); err != nil {
		t.Fatalf("rewritten yaml does not unmarshal: %v", err)
	}
	want := []string{"plain-key", "limited-key", "wildcard-key"}
	if len(probe.APIKeys) != len(want) {
		t.Fatalf("api-keys = %v, want %v", probe.APIKeys, want)
	}
	for i := range want {
		if probe.APIKeys[i] != want[i] {
			t.Fatalf("api-keys[%d] = %q, want %q", i, probe.APIKeys[i], want[i])
		}
	}
	if probe.Port != 8317 {
		t.Fatalf("sibling field lost: port = %d", probe.Port)
	}

	// Only the object-form entry with a concrete list is restricted.
	if acl.Restricted("plain-key") {
		t.Error("plain string key must stay unrestricted")
	}
	if acl.Restricted("wildcard-key") {
		t.Error(`models: ["*"] must stay unrestricted`)
	}
	if !acl.Restricted("limited-key") {
		t.Fatal("limited-key should be restricted")
	}
}

func TestExtractModelACLLeavesPlainConfigAlone(t *testing.T) {
	src := []byte("api-keys:\n  - a\n  - b\n")
	acl, rewritten, err := ExtractModelACL(src)
	if err != nil {
		t.Fatalf("ExtractModelACL: %v", err)
	}
	if acl != nil {
		t.Errorf("acl = %v, want nil for an all-plain list", acl)
	}
	if string(rewritten) != string(src) {
		t.Error("config without object entries must be returned byte-identical")
	}
}

func TestAllowed(t *testing.T) {
	acl := ModelACL{
		"limited": {"deepseek-v4-pro", "牛来"},
	}

	cases := []struct {
		name  string
		key   string
		model string
		want  bool
	}{
		{"unrestricted key passes anything", "other", "claude-opus-5", true},
		{"allowed model", "limited", "deepseek-v4-pro", true},
		{"denied model", "limited", "deepseek-v4-flash", false},
		{"denied expensive model", "limited", "claude-opus-5", false},

		// A CJK model name must survive the rune-reversal round trip.
		{"allowed CJK model", "limited", "牛来", true},

		// Thinking suffixes: both spellings resolve to the base model.
		{"paren thinking suffix", "limited", "deepseek-v4-pro(max)", true},
		{"dash thinking suffix", "limited", "deepseek-v4-pro-high", true},
		{"colon thinking suffix", "limited", "deepseek-v4-pro:low", true},
		{"suffix on denied model stays denied", "limited", "claude-opus-5-max", false},

		// Anthropic dialect rewrites ids; the allow-list stores plain names.
		{"claude dialect allowed", "limited", "claude-fable-5-dd-orp-4v-keespeed", true},
		{"claude dialect CJK allowed", "limited", "claude-fable-5-dd-来牛", true},
		{"claude dialect denied", "limited", "claude-fable-5-dd-hsalf-4v-keespeed", false},
		{"claude dialect with suffix", "limited", "claude-fable-5-dd-orp-4v-keespeed(max)", true},

		// An empty model means there is nothing to authorize here.
		{"empty model defers", "limited", "", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := acl.Allowed(tc.key, tc.model); got != tc.want {
				t.Errorf("Allowed(%q, %q) = %v, want %v", tc.key, tc.model, got, tc.want)
			}
		})
	}
}

func TestAllowedEmptyACLAllowsEverything(t *testing.T) {
	var acl ModelACL
	if !acl.Allowed("anyone", "any-model") {
		t.Error("a nil ACL must not restrict anything")
	}
}

func TestClaudeDialectRoundTrip(t *testing.T) {
	for _, id := range []string{"deepseek-v4-flash", "牛来", "gemini-3.7-flash"} {
		encoded := EncodeClaudeDialectModel(id)
		if encoded == id {
			t.Fatalf("EncodeClaudeDialectModel(%q) did not rewrite", id)
		}
		if got := DecodeClaudeDialectModel(encoded); got != id {
			t.Errorf("round trip %q -> %q -> %q", id, encoded, got)
		}
	}

	// Ids already in the claude- namespace are passed through unchanged.
	if got := EncodeClaudeDialectModel("claude-opus-5"); got != "claude-opus-5" {
		t.Errorf("claude-* id was rewritten: %q", got)
	}
	if got := DecodeClaudeDialectModel("claude-opus-5"); got != "claude-opus-5" {
		t.Errorf("claude-* id was decoded: %q", got)
	}
}

func TestStripThinkingSuffix(t *testing.T) {
	cases := map[string]string{
		"model(max)":        "model",
		"model-high":        "model",
		"model:low":         "model",
		"deepseek-v4-pro":   "deepseek-v4-pro", // "pro" is not a level
		"gpt-5.6-sol":       "gpt-5.6-sol",
		"model-unknownword": "model-unknownword",
	}
	for in, want := range cases {
		if got := stripThinkingSuffix(in); got != want {
			t.Errorf("stripThinkingSuffix(%q) = %q, want %q", in, got, want)
		}
	}
}

// Package config — per-key model access control (fork addition).
//
// Upstream CPA treats every inbound api-key as equivalent: any valid key may
// list and call every registered model. This file adds an optional per-key
// model allow-list.
//
// Design constraint: stay easy to rebase onto upstream. Therefore
//   - APIKeys keeps its []string type (9 call sites across safemode, the
//     management API and the config watcher depend on it),
//   - the allow-list lives in a separate field populated at unmarshal time,
//   - all logic lives in this new file rather than edits scattered upstream.
package config

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// claudeDDModelPrefix mirrors internal/client/claude/models.claudeDDModelPrefix.
//
// In the Anthropic dialect CPA rewrites any model id that does not already
// start with "claude-" into this prefix followed by the original id with its
// characters reversed, e.g.
//
//	deepseek-v4-flash -> claude-fable-5-dd-hsalf-4v-keespeed
//	牛来               -> claude-fable-5-dd-来牛
//
// Allow-lists are written with the plain names, so matching has to undo that
// transformation. Duplicated here (rather than imported) to avoid an import
// cycle: the claude models package depends on config.
const claudeDDModelPrefix = "claude-fable-5-dd-"

// thinkingSuffixes are the discrete reasoning levels a caller may append to a
// model name (see internal/thinking/suffix.go). Both "model-max" and
// "model(max)" spellings occur in the wild.
var thinkingSuffixes = []string{"none", "auto", "minimal", "low", "medium", "high", "xhigh", "max"}

// ModelACL maps an inbound api-key to the model ids it may use.
// A key absent from the map is unrestricted; see Allowed.
type ModelACL map[string][]string

// apiKeyEntry accepts either spelling of an api-keys list item:
//
//	api-keys:
//	  - plain-key-string          # unrestricted
//	  - key: limited-key
//	    models: [model-a, model-b]
type apiKeyEntry struct {
	Key    string   `yaml:"key"`
	Models []string `yaml:"models"`
}

// UnmarshalYAML accepts a scalar (bare key) or a mapping (key + models).
func (e *apiKeyEntry) UnmarshalYAML(value *yaml.Node) error {
	switch value.Kind {
	case yaml.ScalarNode:
		var key string
		if err := value.Decode(&key); err != nil {
			return err
		}
		e.Key = strings.TrimSpace(key)
		e.Models = nil
		return nil
	case yaml.MappingNode:
		var raw struct {
			Key    string   `yaml:"key"`
			Models []string `yaml:"models"`
		}
		if err := value.Decode(&raw); err != nil {
			return err
		}
		e.Key = strings.TrimSpace(raw.Key)
		if e.Key == "" {
			return fmt.Errorf("api-keys entry at line %d is missing the \"key\" field", value.Line)
		}
		e.Models = normalizeModelList(raw.Models)
		return nil
	default:
		return fmt.Errorf("api-keys entry at line %d must be a string or a mapping", value.Line)
	}
}

func normalizeModelList(in []string) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, m := range in {
		m = strings.TrimSpace(m)
		if m == "" {
			continue
		}
		if _, dup := seen[m]; dup {
			continue
		}
		seen[m] = struct{}{}
		out = append(out, m)
	}
	return out
}

// ParseAPIKeyEntries splits a raw api-keys node into the flat key list that the
// rest of the codebase expects plus the per-key allow-list.
//
// An entry with no models field (or an explicit "*") is unrestricted, so
// upgrading an existing config changes no behaviour until models are set.
func ParseAPIKeyEntries(value *yaml.Node) ([]string, ModelACL, error) {
	if value == nil || value.Kind == 0 {
		return nil, nil, nil
	}
	if value.Kind != yaml.SequenceNode {
		return nil, nil, fmt.Errorf("api-keys must be a list, got %s at line %d",
			kindName(value.Kind), value.Line)
	}

	keys := make([]string, 0, len(value.Content))
	acl := make(ModelACL)

	for _, node := range value.Content {
		var entry apiKeyEntry
		if err := entry.UnmarshalYAML(node); err != nil {
			return nil, nil, err
		}
		if entry.Key == "" {
			continue
		}
		keys = append(keys, entry.Key)

		// No models field, or "*" among them, means unrestricted: leave the key
		// out of the ACL entirely so Allowed() short-circuits.
		if len(entry.Models) == 0 || containsWildcard(entry.Models) {
			delete(acl, entry.Key)
			continue
		}
		acl[entry.Key] = entry.Models
	}

	if len(acl) == 0 {
		acl = nil
	}
	return keys, acl, nil
}

func containsWildcard(models []string) bool {
	for _, m := range models {
		if m == "*" {
			return true
		}
	}
	return false
}

func kindName(k yaml.Kind) string {
	switch k {
	case yaml.ScalarNode:
		return "scalar"
	case yaml.MappingNode:
		return "mapping"
	case yaml.SequenceNode:
		return "sequence"
	case yaml.AliasNode:
		return "alias"
	case yaml.DocumentNode:
		return "document"
	default:
		return "unknown"
	}
}

// ExtractModelACL pre-processes raw config bytes before the main unmarshal.
//
// It pulls the allow-lists out of any object-form api-keys entries and rewrites
// that node in place so it becomes a plain list of strings. The main
// yaml.Unmarshal then fills APIKeys []string exactly as upstream does, leaving
// every existing call site untouched.
//
// Returns the ACL (nil when no key is restricted) and the rewritten YAML. On any
// structural surprise it returns the input unchanged rather than failing the
// whole config load — an unparsable api-keys section is upstream's business to
// report, not ours.
func ExtractModelACL(data []byte) (ModelACL, []byte, error) {
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil, data, nil // let the main unmarshal produce the real error
	}
	if root.Kind != yaml.DocumentNode || len(root.Content) == 0 {
		return nil, data, nil
	}
	doc := root.Content[0]
	if doc.Kind != yaml.MappingNode {
		return nil, data, nil
	}

	var keysNode *yaml.Node
	for i := 0; i+1 < len(doc.Content); i += 2 {
		if doc.Content[i].Value == "api-keys" {
			keysNode = doc.Content[i+1]
			break
		}
	}
	if keysNode == nil || keysNode.Kind != yaml.SequenceNode {
		return nil, data, nil
	}

	// Nothing to do unless at least one entry uses the object form.
	hasMapping := false
	for _, n := range keysNode.Content {
		if n.Kind == yaml.MappingNode {
			hasMapping = true
			break
		}
	}
	if !hasMapping {
		return nil, data, nil
	}

	keys, acl, err := ParseAPIKeyEntries(keysNode)
	if err != nil {
		return nil, data, err
	}

	// Flatten the sequence to plain scalars.
	flattened := make([]*yaml.Node, 0, len(keys))
	for _, k := range keys {
		flattened = append(flattened, &yaml.Node{
			Kind:  yaml.ScalarNode,
			Tag:   "!!str",
			Value: k,
		})
	}
	keysNode.Content = flattened
	keysNode.Style = 0

	rewritten, err := yaml.Marshal(&root)
	if err != nil {
		return nil, data, fmt.Errorf("rewrite api-keys section: %w", err)
	}
	return acl, rewritten, nil
}

// Restricted reports whether the key has an allow-list at all.
func (a ModelACL) Restricted(key string) bool {
	if len(a) == 0 {
		return false
	}
	_, ok := a[strings.TrimSpace(key)]
	return ok
}

// Allowed reports whether key may use model.
//
// Unrestricted keys (absent from the ACL) always pass, which keeps the default
// behaviour identical to upstream. An empty key also passes so that unauthenticated
// paths — management endpoints, OAuth callbacks — are never gated here.
func (a ModelACL) Allowed(key, model string) bool {
	if len(a) == 0 {
		return true
	}
	allowed, restricted := a[strings.TrimSpace(key)]
	if !restricted {
		return true
	}
	model = strings.TrimSpace(model)
	if model == "" {
		// No model in the request: nothing to authorize here, let the handler
		// decide. Model-bearing requests are covered by the middleware.
		return true
	}

	candidates := modelCandidates(model)
	for _, want := range allowed {
		if want == "*" {
			return true
		}
		for _, got := range candidates {
			if strings.EqualFold(want, got) {
				return true
			}
		}
	}
	return false
}

// AllowedModels returns the allow-list for key, and whether one exists.
func (a ModelACL) AllowedModels(key string) ([]string, bool) {
	if len(a) == 0 {
		return nil, false
	}
	models, ok := a[strings.TrimSpace(key)]
	return models, ok
}

// modelCandidates expands a requested model id into every spelling that should
// match the same allow-list entry: as sent, without a thinking suffix, and with
// the Anthropic-dialect renaming undone.
func modelCandidates(model string) []string {
	out := make([]string, 0, 4)
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" {
			return
		}
		for _, existing := range out {
			if existing == v {
				return
			}
		}
		out = append(out, v)
	}

	add(model)
	add(stripThinkingSuffix(model))

	decoded := DecodeClaudeDialectModel(model)
	add(decoded)
	add(stripThinkingSuffix(decoded))

	return out
}

// stripThinkingSuffix removes a trailing reasoning-level marker in either the
// "model(max)" or "model-max" / "model:max" form.
func stripThinkingSuffix(model string) string {
	if open := strings.LastIndex(model, "("); open > 0 && strings.HasSuffix(model, ")") {
		return strings.TrimSpace(model[:open])
	}
	for _, sep := range []string{"-", ":"} {
		if idx := strings.LastIndex(model, sep); idx > 0 {
			tail := strings.ToLower(model[idx+len(sep):])
			for _, level := range thinkingSuffixes {
				if tail == level {
					return model[:idx]
				}
			}
		}
	}
	return model
}

// EncodeClaudeDialectModel mirrors claude/models.EnsureClaudeModelIDPrefix.
func EncodeClaudeDialectModel(id string) string {
	if id == "" || strings.HasPrefix(id, "claude-") {
		return id
	}
	return claudeDDModelPrefix + reverseRunes(id)
}

// DecodeClaudeDialectModel mirrors claude/models.ResolveClaudeModelIDPrefix,
// turning a claude-fable-5-dd-* id back into the original model name. Ids that
// do not carry the prefix are returned unchanged.
func DecodeClaudeDialectModel(id string) string {
	if id == "" {
		return id
	}
	base, suffix := id, ""
	if open := strings.LastIndex(id, "("); open > 0 && strings.HasSuffix(id, ")") {
		base = id[:open]
		suffix = id[open+1 : len(id)-1]
	}
	if !strings.HasPrefix(base, claudeDDModelPrefix) {
		return id
	}
	encoded := base[len(claudeDDModelPrefix):]
	if encoded == "" {
		return id
	}
	resolved := reverseRunes(encoded)
	if suffix != "" {
		return resolved + "(" + suffix + ")"
	}
	return resolved
}

func reverseRunes(s string) string {
	runes := []rune(s)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}

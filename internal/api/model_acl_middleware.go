// Per-key model access control middleware (fork addition).
//
// Runs immediately after AuthMiddleware, which has already put the caller's
// api-key into the gin context as "userApiKey". Requests naming a model the key
// is not allowed to use are rejected before reaching any executor, so they
// consume no upstream quota.
//
// Placement rationale: AuthMiddleware is registered on 4 route groups, so a
// single middleware covers every model-bearing endpoint without touching any
// handler, translator or executor — the parts of the tree upstream changes most.
package api

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// maxModelSniffBytes caps how much of a request body is buffered to find the
// "model" field. Real payloads put it in the first few hundred bytes; anything
// larger is streamed through untouched.
const maxModelSniffBytes = 64 << 10

// ModelACLMiddleware enforces cfg.ModelACL for model-bearing requests.
// It is a no-op when no key is restricted, so unmodified configs pay nothing.
func ModelACLMiddleware(cfg *config.Config) gin.HandlerFunc {
	return modelACLMiddleware(func() *config.Config { return cfg })
}

// DynamicModelACLMiddleware resolves the latest hot-reloaded configuration for
// each request. Server route middleware otherwise captures only the startup
// config pointer and misses assignments changed through Management.
func DynamicModelACLMiddleware(getConfig func() *config.Config) gin.HandlerFunc {
	return modelACLMiddleware(getConfig)
}

func modelACLMiddleware(getConfig func() *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := getConfig()
		if cfg == nil || len(cfg.ModelACL) == 0 {
			c.Next()
			return
		}

		key := principalFromContext(c)
		if key == "" || !cfg.ModelACL.Restricted(key) {
			c.Next()
			return
		}

		model := requestedModel(c)
		if model == "" {
			// Nothing to authorize (e.g. a listing or control endpoint). The
			// response filter in the models handlers covers listings.
			c.Next()
			return
		}

		if cfg.ModelACL.Allowed(key, model) {
			c.Next()
			return
		}

		abortModelNotFound(c, model)
	}
}

func principalFromContext(c *gin.Context) string {
	v, ok := c.Get("userApiKey")
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

// requestedModel extracts the target model from the request, covering all
// dialects: Gemini puts it in the path, everything else in a JSON body field.
func requestedModel(c *gin.Context) string {
	// Gemini: /v1beta/models/<model>:generateContent
	if raw := c.Param("action"); raw != "" {
		if m := modelFromGeminiAction(raw); m != "" {
			return m
		}
	}

	if c.Request == nil || c.Request.Body == nil {
		return ""
	}
	if c.Request.Method != http.MethodPost && c.Request.Method != http.MethodPut {
		return ""
	}

	// Buffer the body so the downstream handler still sees it intact.
	limited := io.LimitReader(c.Request.Body, maxModelSniffBytes)
	head, err := io.ReadAll(limited)
	if err != nil {
		// Restore what was read and let the handler surface the error.
		c.Request.Body = io.NopCloser(bytes.NewReader(head))
		return ""
	}
	rest := c.Request.Body
	c.Request.Body = io.NopCloser(io.MultiReader(bytes.NewReader(head), rest))

	return strings.TrimSpace(gjson.GetBytes(head, "model").String())
}

// modelFromGeminiAction turns "<model>:generateContent" into "<model>".
// The gin wildcard param arrives with a leading slash.
func modelFromGeminiAction(action string) string {
	action = strings.TrimPrefix(action, "/")
	if action == "" {
		return ""
	}
	if idx := strings.Index(action, ":"); idx > 0 {
		return action[:idx]
	}
	// A bare /v1beta/models/<model> GET is a metadata lookup, still model-scoped.
	if !strings.Contains(action, "/") {
		return action
	}
	return ""
}

// abortModelNotFound reports the model as nonexistent rather than forbidden.
//
// 404 is deliberate: a 403 would confirm the model exists and merely isn't
// permitted, letting a caller enumerate the full model list. With 404 a
// restricted key cannot distinguish "no such model" from "not yours".
func abortModelNotFound(c *gin.Context, model string) {
	message := "The model `" + model + "` does not exist or you do not have access to it."

	if isAnthropicDialect(c) {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{
			"type": "error",
			"error": gin.H{
				"type":    "not_found_error",
				"message": message,
			},
		})
		return
	}

	c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": gin.H{
		"message": message,
		"type":    "invalid_request_error",
		"param":   nil,
		"code":    "model_not_found",
	}})
}

func isAnthropicDialect(c *gin.Context) bool {
	if c.GetHeader("Anthropic-Version") != "" || c.GetHeader("anthropic-version") != "" {
		return true
	}
	return strings.Contains(strings.ToLower(c.GetHeader("User-Agent")), "claude-cli")
}

// ---------------------------------------------------------------------------
// Model listing filter
// ---------------------------------------------------------------------------

// ModelListACLMiddleware trims model listings down to what the calling key may
// use, so a restricted caller never sees models it cannot invoke.
//
// This is implemented as a response interceptor rather than edits inside each
// listing handler because /v1/models alone fans out to five branches (Grok,
// Home-Codex, Home, Claude, OpenAI) plus the Gemini endpoint. Buffering the
// response keeps all of them covered from one place.
//
// Listings are small JSON documents, so buffering costs nothing meaningful;
// non-JSON and error responses pass through untouched.
func ModelListACLMiddleware(cfg *config.Config) gin.HandlerFunc {
	return modelListACLMiddleware(func() *config.Config { return cfg })
}

// DynamicModelListACLMiddleware is the hot-reload-aware listing counterpart to
// DynamicModelACLMiddleware.
func DynamicModelListACLMiddleware(getConfig func() *config.Config) gin.HandlerFunc {
	return modelListACLMiddleware(getConfig)
}

func modelListACLMiddleware(getConfig func() *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := getConfig()
		if cfg == nil || len(cfg.ModelACL) == 0 {
			c.Next()
			return
		}
		key := principalFromContext(c)
		if key == "" || !cfg.ModelACL.Restricted(key) {
			c.Next()
			return
		}

		buf := &modelListBuffer{ResponseWriter: c.Writer}
		c.Writer = buf
		c.Next()
		c.Writer = buf.ResponseWriter

		body := buf.body.Bytes()
		if buf.status != 0 && buf.status != http.StatusOK {
			writeRaw(c, buf.status, body)
			return
		}
		if !gjson.ValidBytes(body) {
			writeRaw(c, http.StatusOK, body)
			return
		}

		filtered, changed := filterModelListJSON(body, key, cfg.ModelACL)
		if !changed {
			writeRaw(c, http.StatusOK, body)
			return
		}
		// Content-Length from the inner handler no longer matches.
		c.Writer.Header().Del("Content-Length")
		writeRaw(c, http.StatusOK, filtered)
	}
}

func writeRaw(c *gin.Context, status int, body []byte) {
	if status == 0 {
		status = http.StatusOK
	}
	c.Writer.WriteHeader(status)
	if len(body) > 0 {
		_, _ = c.Writer.Write(body)
	}
}

// modelListBuffer captures a handler's response instead of sending it straight
// to the client, so the body can be rewritten afterwards.
type modelListBuffer struct {
	gin.ResponseWriter
	body   bytes.Buffer
	status int
}

func (w *modelListBuffer) Write(b []byte) (int, error) { return w.body.Write(b) }

func (w *modelListBuffer) WriteString(s string) (int, error) { return w.body.WriteString(s) }

func (w *modelListBuffer) WriteHeader(status int) { w.status = status }

// filterModelListJSON removes entries the key may not use from whichever array
// the dialect uses, and repairs the pagination cursors that describe it.
//
// Cursor repair matters: the Anthropic dialect reports first_id/last_id computed
// from the unfiltered list. Leaving them pointing at removed entries makes
// clients treat the listing as malformed and report "no models available".
func filterModelListJSON(body []byte, key string, acl config.ModelACL) ([]byte, bool) {
	arrayField := ""
	for _, field := range []string{"data", "models"} {
		if gjson.GetBytes(body, field).IsArray() {
			arrayField = field
			break
		}
	}
	if arrayField == "" {
		return body, false
	}

	entries := gjson.GetBytes(body, arrayField).Array()
	kept := make([]string, 0, len(entries))
	keptIDs := make([]string, 0, len(entries))
	removed := false

	for _, entry := range entries {
		id := modelIDFromEntry(entry)
		if id != "" && !acl.Allowed(key, id) {
			removed = true
			continue
		}
		kept = append(kept, entry.Raw)
		if raw := entry.Get("id").String(); raw != "" {
			keptIDs = append(keptIDs, raw)
		}
	}
	if !removed {
		return body, false
	}

	out := []byte("{}")
	// Preserve every sibling field, replacing only the array and its cursors.
	gjson.ParseBytes(body).ForEach(func(k, v gjson.Result) bool {
		field := k.String()
		if field == arrayField {
			return true
		}
		out, _ = sjson.SetRawBytes(out, escapeJSONPath(field), []byte(v.Raw))
		return true
	})
	out, _ = sjson.SetRawBytes(out, arrayField, []byte("["+strings.Join(kept, ",")+"]"))

	// Anthropic cursors.
	if gjson.GetBytes(body, "first_id").Exists() {
		out, _ = setStringOrNull(out, "first_id", firstOrEmpty(keptIDs))
	}
	if gjson.GetBytes(body, "last_id").Exists() {
		out, _ = setStringOrNull(out, "last_id", lastOrEmpty(keptIDs))
	}
	if gjson.GetBytes(body, "has_more").Exists() {
		out, _ = sjson.SetBytes(out, "has_more", false)
	}
	// Gemini cursor: a filtered page must not claim a continuation.
	if gjson.GetBytes(body, "nextPageToken").Exists() {
		out, _ = sjson.DeleteBytes(out, "nextPageToken")
	}

	return out, true
}

// modelIDFromEntry reads whichever field the dialect uses for the model id.
// Gemini prefixes names with "models/".
func modelIDFromEntry(entry gjson.Result) string {
	for _, field := range []string{"id", "name", "model"} {
		if v := entry.Get(field).String(); v != "" {
			return strings.TrimPrefix(v, "models/")
		}
	}
	return ""
}

func setStringOrNull(body []byte, path, value string) ([]byte, error) {
	if value == "" {
		return sjson.SetRawBytes(body, path, []byte("null"))
	}
	return sjson.SetBytes(body, path, value)
}

func firstOrEmpty(v []string) string {
	if len(v) == 0 {
		return ""
	}
	return v[0]
}

func lastOrEmpty(v []string) string {
	if len(v) == 0 {
		return ""
	}
	return v[len(v)-1]
}

// escapeJSONPath protects sjson path metacharacters in a literal field name.
func escapeJSONPath(field string) string {
	replacer := strings.NewReplacer(".", `\.`, "*", `\*`, "?", `\?`, "#", `\#`)
	return replacer.Replace(field)
}

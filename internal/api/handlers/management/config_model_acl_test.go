package management

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
)

func TestPutAndGetModelACL(t *testing.T) {
	configPath := writeTestConfigFile(t)
	if errWrite := os.WriteFile(configPath, []byte("api-keys:\n  - old-key\n"), 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
	h := &Handler{cfg: &config.Config{SDKConfig: config.SDKConfig{APIKeys: []string{"old-key"}}}, configFilePath: configPath}

	putRecorder := httptest.NewRecorder()
	putContext, _ := gin.CreateTestContext(putRecorder)
	putContext.Request = httptest.NewRequest(http.MethodPut, "/v0/management/model-acl", strings.NewReader(`{"items":[{"key":"all-key","restricted":false,"models":[]},{"key":"limited-key","restricted":true,"models":["model-b","model-a","model-a"]}]}`))
	putContext.Request.Header.Set("Content-Type", "application/json")
	h.PutModelACL(putContext)
	if putRecorder.Code != http.StatusOK {
		t.Fatalf("PUT status = %d; body=%s", putRecorder.Code, putRecorder.Body.String())
	}
	if !h.cfg.ModelACL.Allowed("limited-key", "model-a") || h.cfg.ModelACL.Allowed("limited-key", "model-c") {
		t.Fatalf("ACL = %#v", h.cfg.ModelACL)
	}

	saved, errRead := os.ReadFile(configPath)
	if errRead != nil {
		t.Fatal(errRead)
	}
	if !strings.Contains(string(saved), "key: limited-key") || !strings.Contains(string(saved), "models:") {
		t.Fatalf("saved config lost ACL:\n%s", saved)
	}

	getRecorder := httptest.NewRecorder()
	getContext, _ := gin.CreateTestContext(getRecorder)
	getContext.Request = httptest.NewRequest(http.MethodGet, "/v0/management/model-acl", nil)
	h.GetModelACL(getContext)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("GET status = %d; body=%s", getRecorder.Code, getRecorder.Body.String())
	}
	var payload struct {
		Items []modelACLItem `json:"items"`
	}
	if errDecode := json.Unmarshal(getRecorder.Body.Bytes(), &payload); errDecode != nil {
		t.Fatal(errDecode)
	}
	if len(payload.Items) != 2 || payload.Items[0].Restricted || !payload.Items[1].Restricted {
		t.Fatalf("items = %#v", payload.Items)
	}
}

func TestPutModelACLRejectsRestrictedKeyWithoutModels(t *testing.T) {
	h := &Handler{cfg: &config.Config{}, configFilePath: writeTestConfigFile(t)}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/v0/management/model-acl", strings.NewReader(`{"items":[{"key":"limited","restricted":true}]}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	h.PutModelACL(ctx)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestReconcileModelACLKeys(t *testing.T) {
	acl := config.ModelACL{"old": {"model-a"}, "keep": {"model-b"}}
	renamed := reconcileModelACLKeys([]string{"old", "keep"}, []string{"new", "keep"}, acl)
	if !renamed.Restricted("new") || renamed.Restricted("old") || !renamed.Restricted("keep") {
		t.Fatalf("renamed ACL = %#v", renamed)
	}
	deleted := reconcileModelACLKeys([]string{"old", "keep"}, []string{"keep"}, acl)
	if len(deleted) != 1 || !deleted.Restricted("keep") {
		t.Fatalf("deleted ACL = %#v", deleted)
	}
}

package management

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestGetServerVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	handler := &Handler{}

	handler.GetServerVersion(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var response serverVersionResponse
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &response); errDecode != nil {
		t.Fatalf("decode response: %v", errDecode)
	}
	if response.Version != buildinfo.Version {
		t.Fatalf("version = %q, want %q", response.Version, buildinfo.Version)
	}
	if response.Repository != buildinfo.UpdateRepository {
		t.Fatalf("repository = %q, want %q", response.Repository, buildinfo.UpdateRepository)
	}
	if _, errParse := time.Parse(time.RFC3339Nano, response.StartedAt); errParse != nil {
		t.Fatalf("started_at = %q, want RFC3339 timestamp: %v", response.StartedAt, errParse)
	}
}

func TestNewUpdateServiceUsesManagementStaticDir(t *testing.T) {
	staticDir := t.TempDir()
	t.Setenv("MANAGEMENT_STATIC_PATH", staticDir)

	handler := &Handler{
		cfg:            &config.Config{},
		configFilePath: filepath.Join(t.TempDir(), "config.yaml"),
	}
	service := handler.newUpdateService(time.Second)
	if service.ManagementStaticDir != staticDir {
		t.Fatalf("ManagementStaticDir = %q, want %q", service.ManagementStaticDir, staticDir)
	}
}

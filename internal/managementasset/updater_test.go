package managementasset

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

type githubAssetTransport func(*http.Request) (*http.Response, error)

func (f githubAssetTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestFetchLatestAssetSetsGitHubAuthorization(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "asset-token")
	t.Setenv("GITSTORE_GIT_TOKEN", "")
	t.Setenv("GITSTORE_GIT_URL", "")

	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		authorization = req.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"assets":[{"name":"management.html","browser_download_url":"https://example.com/management.html","digest":"sha256:abc123"}]}`))
	}))
	defer server.Close()

	asset, remoteHash, err := fetchLatestAsset(t.Context(), server.Client(), server.URL)
	if err != nil {
		t.Fatalf("fetchLatestAsset() error = %v", err)
	}
	if authorization != "" {
		t.Fatal("token leaked to non-GitHub release URL")
	}
	client := &http.Client{Transport: githubAssetTransport(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Authorization") != "Bearer asset-token" {
			t.Fatal("GitHub API token missing")
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"assets":[{"name":"management.html","digest":"sha256:abc123"}]}`))}, nil
	})}
	if _, _, errGitHub := fetchLatestAsset(t.Context(), client, "https://api.github.com/repos/owner/repo/releases/latest"); errGitHub != nil {
		t.Fatal(errGitHub)
	}
	if asset == nil || asset.Name != managementAssetName {
		t.Fatalf("asset = %#v, want %q", asset, managementAssetName)
	}
	if remoteHash != "abc123" {
		t.Fatalf("remoteHash = %q, want %q", remoteHash, "abc123")
	}
}

func TestFetchLatestAssetOmitsAuthorizationWithoutToken(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "")
	t.Setenv("github_token", "")
	t.Setenv("GITSTORE_GIT_TOKEN", "")
	t.Setenv("GITSTORE_GIT_URL", "")

	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		authorization = req.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"assets":[{"name":"management.html","browser_download_url":"https://example.com/management.html","digest":"sha256:abc123"}]}`))
	}))
	defer server.Close()

	asset, remoteHash, err := fetchLatestAsset(t.Context(), server.Client(), server.URL)
	if err != nil {
		t.Fatalf("fetchLatestAsset() error = %v", err)
	}
	if authorization != "" {
		t.Fatalf("Authorization = %q, want empty", authorization)
	}
	if asset == nil || asset.Name != managementAssetName {
		t.Fatalf("asset = %#v, want %q", asset, managementAssetName)
	}
	if remoteHash != "abc123" {
		t.Fatalf("remoteHash = %q, want %q", remoteHash, "abc123")
	}
}

func TestAutoUpdateSkipReason(t *testing.T) {
	tests := []struct {
		name       string
		cfg        *config.Config
		wantReason string
		wantSkip   bool
	}{
		{
			name:       "nil config",
			cfg:        nil,
			wantReason: "config not yet available",
			wantSkip:   true,
		},
		{
			name: "cluster mode",
			cfg: &config.Config{
				Home: config.HomeConfig{Enabled: true},
			},
			wantReason: "cluster mode enabled",
			wantSkip:   true,
		},
		{
			name: "control panel disabled",
			cfg: &config.Config{
				RemoteManagement: config.RemoteManagement{DisableControlPanel: true},
			},
			wantReason: "control panel disabled",
			wantSkip:   true,
		},
		{
			name: "auto update disabled",
			cfg: &config.Config{
				RemoteManagement: config.RemoteManagement{DisableAutoUpdatePanel: true},
			},
			wantReason: "disable-auto-update-panel is enabled",
			wantSkip:   true,
		},
		{
			name:       "enabled",
			cfg:        &config.Config{},
			wantReason: "",
			wantSkip:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotReason, gotSkip := autoUpdateSkipReason(tt.cfg)
			if gotReason != tt.wantReason || gotSkip != tt.wantSkip {
				t.Fatalf("autoUpdateSkipReason() = (%q, %t), want (%q, %t)", gotReason, gotSkip, tt.wantReason, tt.wantSkip)
			}
		})
	}
}

func writeManagementPanel(t *testing.T, path string, version string) {
	t.Helper()
	content := fmt.Sprintf(`<!doctype html><html><head><meta name="cpa-version" content="%s" /></head><body></body></html>`, version)
	if errWrite := os.WriteFile(path, []byte(content), 0o644); errWrite != nil {
		t.Fatalf("write management panel: %v", errWrite)
	}
}

func TestManagementPanelVersion(t *testing.T) {
	panelPath := filepath.Join(t.TempDir(), "management.html")
	writeManagementPanel(t, panelPath, "v1.2.3")
	if got := managementPanelVersion(panelPath); got != "1.2.3" {
		t.Fatalf("managementPanelVersion() = %q, want %q", got, "1.2.3")
	}
	writeManagementPanel(t, panelPath, "v1.2.3-3-gabcdef")
	if got := managementPanelVersion(panelPath); got != "1.2.3" {
		t.Fatalf("managementPanelVersion(git describe) = %q, want %q", got, "1.2.3")
	}
	if got := managementPanelVersion(filepath.Join(t.TempDir(), "missing.html")); got != "" {
		t.Fatalf("managementPanelVersion(missing) = %q, want empty", got)
	}
}

func TestSyncPanelAfterSelfUpdateForExecutable(t *testing.T) {
	t.Run("panel version matches server", func(t *testing.T) {
		staticDir := t.TempDir()
		t.Setenv("MANAGEMENT_STATIC_PATH", staticDir)
		executablePath := filepath.Join(t.TempDir(), "CLIProxyAPI")
		if errWrite := os.WriteFile(executablePath, []byte("binary"), 0o755); errWrite != nil {
			t.Fatalf("write executable: %v", errWrite)
		}
		writeManagementPanel(t, filepath.Join(staticDir, "management.html"), buildinfo.Version)
		called := false
		if !syncPanelAfterSelfUpdateWith(executablePath, filepath.Join(t.TempDir(), "config.yaml"), &config.Config{}, func(context.Context, string, string, string) bool {
			called = true
			return false
		}) {
			t.Fatal("sync did not recognize a matching management panel version")
		}
		if called {
			t.Fatal("sync refreshed a panel whose version already matches")
		}
	})

	t.Run("missing panel refreshes", func(t *testing.T) {
		staticDir := t.TempDir()
		t.Setenv("MANAGEMENT_STATIC_PATH", staticDir)
		executablePath := filepath.Join(t.TempDir(), "CLIProxyAPI")
		if errWrite := os.WriteFile(executablePath, []byte("binary"), 0o755); errWrite != nil {
			t.Fatalf("write executable: %v", errWrite)
		}
		called := false
		if !syncPanelAfterSelfUpdateWith(executablePath, filepath.Join(t.TempDir(), "config.yaml"), &config.Config{}, func(_ context.Context, dir string, _ string, _ string) bool {
			called = true
			writeManagementPanel(t, filepath.Join(dir, "management.html"), buildinfo.Version)
			return true
		}) {
			t.Fatal("sync did not refresh a missing management panel")
		}
		if !called {
			t.Fatal("sync did not attempt to refresh a missing management panel")
		}
	})

	t.Run("legacy panel after old updater refreshes", func(t *testing.T) {
		staticDir := t.TempDir()
		t.Setenv("MANAGEMENT_STATIC_PATH", staticDir)
		executablePath := filepath.Join(t.TempDir(), "CLIProxyAPI")
		if errWrite := os.WriteFile(executablePath, []byte("new binary"), 0o755); errWrite != nil {
			t.Fatalf("write executable: %v", errWrite)
		}
		panelPath := filepath.Join(staticDir, "management.html")
		if errWrite := os.WriteFile(panelPath, []byte("<html>legacy panel</html>"), 0o644); errWrite != nil {
			t.Fatalf("write legacy panel: %v", errWrite)
		}
		panelTime := time.Now().Add(-time.Hour)
		if errTime := os.Chtimes(panelPath, panelTime, panelTime); errTime != nil {
			t.Fatalf("set panel time: %v", errTime)
		}
		called := false
		if !syncPanelAfterSelfUpdateWith(executablePath, filepath.Join(t.TempDir(), "config.yaml"), &config.Config{}, func(_ context.Context, dir string, _ string, _ string) bool {
			called = true
			writeManagementPanel(t, filepath.Join(dir, "management.html"), buildinfo.Version)
			return true
		}) {
			t.Fatal("sync did not repair a legacy panel left by the old updater")
		}
		if !called {
			t.Fatal("sync did not attempt to repair a legacy panel")
		}
	})

	t.Run("version marker triggers legacy panel refresh", func(t *testing.T) {
		staticDir := t.TempDir()
		t.Setenv("MANAGEMENT_STATIC_PATH", staticDir)
		executablePath := filepath.Join(t.TempDir(), "CLIProxyAPI")
		if errWrite := os.WriteFile(executablePath, []byte("binary"), 0o755); errWrite != nil {
			t.Fatalf("write executable: %v", errWrite)
		}
		if errWrite := os.WriteFile(executablePath+".version", []byte(buildinfo.Version+"\n"), 0o644); errWrite != nil {
			t.Fatalf("write version marker: %v", errWrite)
		}
		panelPath := filepath.Join(staticDir, "management.html")
		if errWrite := os.WriteFile(panelPath, []byte("<html>legacy panel</html>"), 0o644); errWrite != nil {
			t.Fatalf("write legacy panel: %v", errWrite)
		}
		panelTime := time.Now().Add(time.Hour)
		if errTime := os.Chtimes(panelPath, panelTime, panelTime); errTime != nil {
			t.Fatalf("set panel time: %v", errTime)
		}
		called := false
		if !syncPanelAfterSelfUpdateWith(executablePath, filepath.Join(t.TempDir(), "config.yaml"), &config.Config{}, func(_ context.Context, dir string, _ string, _ string) bool {
			called = true
			writeManagementPanel(t, filepath.Join(dir, "management.html"), buildinfo.Version)
			return true
		}) {
			t.Fatal("sync did not honor the version marker for a legacy panel")
		}
		if !called {
			t.Fatal("sync did not attempt to refresh a legacy panel with a matching version marker")
		}
		if _, errMarker := os.Stat(executablePath + ".version"); !os.IsNotExist(errMarker) {
			t.Fatalf("version marker was not removed: %v", errMarker)
		}
	})

	t.Run("legacy panel without update evidence skips", func(t *testing.T) {
		staticDir := t.TempDir()
		t.Setenv("MANAGEMENT_STATIC_PATH", staticDir)
		executablePath := filepath.Join(t.TempDir(), "CLIProxyAPI")
		if errWrite := os.WriteFile(executablePath, []byte("binary"), 0o755); errWrite != nil {
			t.Fatalf("write executable: %v", errWrite)
		}
		panelPath := filepath.Join(staticDir, "management.html")
		if errWrite := os.WriteFile(panelPath, []byte("<html>legacy panel</html>"), 0o644); errWrite != nil {
			t.Fatalf("write legacy panel: %v", errWrite)
		}
		panelTime := time.Now().Add(time.Hour)
		if errTime := os.Chtimes(panelPath, panelTime, panelTime); errTime != nil {
			t.Fatalf("set panel time: %v", errTime)
		}
		called := false
		if syncPanelAfterSelfUpdateWith(executablePath, filepath.Join(t.TempDir(), "config.yaml"), &config.Config{}, func(context.Context, string, string, string) bool {
			called = true
			return true
		}) {
			t.Fatal("sync reported success without evidence of a self-update")
		}
		if called {
			t.Fatal("sync attempted to refresh an unchanged legacy install")
		}
	})
}

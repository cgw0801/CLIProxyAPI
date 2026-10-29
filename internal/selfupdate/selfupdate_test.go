package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		name  string
		left  string
		right string
		want  int
	}{
		{name: "newer patch", left: "0.0.2", right: "0.0.1", want: 1},
		{name: "same with prefix", left: "v0.0.1", right: "0.0.1", want: 0},
		{name: "older minor", left: "0.1.0", right: "0.2.0", want: -1},
		{name: "missing segment", left: "1.0", right: "1.0.1", want: -1},
		{name: "prerelease ignored", left: "1.2.3-beta", right: "1.2.3", want: 0},
		{name: "invalid versions", left: "dev", right: "0.0.1", want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := compareVersions(tt.left, tt.right); got != tt.want {
				t.Fatalf("compareVersions(%q, %q) = %d, want %d", tt.left, tt.right, got, tt.want)
			}
		})
	}
}

func TestReleaseAssetNames(t *testing.T) {
	linux := releaseAssetNames("v0.0.1", "linux", "amd64")
	wantLinux := []string{
		"CLIProxyAPI_0.0.1_linux_amd64.tar.gz",
		"CLIProxyAPI_0.0.1_linux_amd64_no-plugin.tar.gz",
	}
	if !reflect.DeepEqual(linux, wantLinux) {
		t.Fatalf("linux asset names = %v, want %v", linux, wantLinux)
	}

	windows := releaseAssetNames("0.0.1", "windows", "amd64")
	wantWindows := []string{"CLIProxyAPI_0.0.1_windows_amd64.zip"}
	if !reflect.DeepEqual(windows, wantWindows) {
		t.Fatalf("windows asset names = %v, want %v", windows, wantWindows)
	}
}

func TestCheckTreatsMissingReleaseAsLatest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	service := &Service{
		Repository:     "example/CLIProxyAPI",
		APIBaseURL:     server.URL,
		HTTPClient:     server.Client(),
		CurrentVersion: "0.0.1",
		GOOS:           "linux",
		GOARCH:         "amd64",
	}
	status, errCheck := service.Check(context.Background())
	if errCheck != nil {
		t.Fatalf("Check: %v", errCheck)
	}
	if status.UpdateAvailable || status.LatestVersion != "0.0.1" {
		t.Fatalf("unexpected status: %+v", status)
	}
	if status.ReleaseURL != "https://github.com/example/CLIProxyAPI/releases" {
		t.Fatalf("release URL = %q", status.ReleaseURL)
	}
}

func TestChecksumFor(t *testing.T) {
	payload := []byte("release payload")
	digest := sha256.Sum256(payload)
	data := []byte(hex.EncodeToString(digest[:]) + "  CLIProxyAPI_0.0.1_linux_amd64.tar.gz\n")

	got, errChecksum := checksumFor("CLIProxyAPI_0.0.1_linux_amd64.tar.gz", data)
	if errChecksum != nil {
		t.Fatalf("checksumFor: %v", errChecksum)
	}
	if got != hex.EncodeToString(digest[:]) {
		t.Fatalf("checksum = %q", got)
	}
}

func buildUpdateArchive(t *testing.T, binary []byte, managementHTML []byte) []byte {
	t.Helper()

	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	entries := []struct {
		name string
		mode int64
		data []byte
	}{
		{name: "static/management.html", mode: 0o644, data: managementHTML},
		{name: "CLIProxyAPI", mode: 0o755, data: binary},
	}
	for _, entry := range entries {
		if len(entry.data) == 0 {
			continue
		}
		if errWrite := tarWriter.WriteHeader(&tar.Header{
			Name:     entry.name,
			Mode:     entry.mode,
			Size:     int64(len(entry.data)),
			Typeflag: tar.TypeReg,
		}); errWrite != nil {
			t.Fatalf("write tar header: %v", errWrite)
		}
		if _, errWrite := tarWriter.Write(entry.data); errWrite != nil {
			t.Fatalf("write tar payload: %v", errWrite)
		}
	}
	if errClose := tarWriter.Close(); errClose != nil {
		t.Fatalf("close tar: %v", errClose)
	}
	if errClose := gzipWriter.Close(); errClose != nil {
		t.Fatalf("close gzip: %v", errClose)
	}
	return archive.Bytes()
}

func TestExtractUpdate(t *testing.T) {
	binary := []byte("new binary")
	managementHTML := []byte("<html>management panel</html>")
	archive := buildUpdateArchive(t, binary, managementHTML)

	path, gotManagementHTML, errExtract := extractUpdate(archive, t.TempDir())
	if errExtract != nil {
		t.Fatalf("extractUpdate: %v", errExtract)
	}
	got, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatalf("read extracted binary: %v", errRead)
	}
	if !bytes.Equal(got, binary) {
		t.Fatalf("extracted payload = %q", got)
	}
	if !bytes.Equal(gotManagementHTML, managementHTML) {
		t.Fatalf("extracted management panel = %q", gotManagementHTML)
	}
	if filepath.Base(path) == "CLIProxyAPI" {
		t.Fatal("extracted binary should use a temporary filename")
	}
}

func TestStageManagementHTML(t *testing.T) {
	staticDir := t.TempDir()
	payload := []byte("<html>staged management panel</html>")

	finalPath, stagedPath, errStage := stageManagementHTML(staticDir, payload)
	if errStage != nil {
		t.Fatalf("stageManagementHTML: %v", errStage)
	}
	if finalPath != filepath.Join(staticDir, managementHTMLName) {
		t.Fatalf("final path = %q", finalPath)
	}
	if stagedPath == "" {
		t.Fatal("staged path is empty")
	}
	if errRename := os.Rename(stagedPath, finalPath); errRename != nil {
		t.Fatalf("install staged management panel: %v", errRename)
	}
	got, errRead := os.ReadFile(finalPath)
	if errRead != nil {
		t.Fatalf("read management panel: %v", errRead)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("management panel = %q", got)
	}
}

func TestInstallUpdateArtifacts(t *testing.T) {
	targetDir := t.TempDir()
	targetPath := filepath.Join(targetDir, "CLIProxyAPI")
	staticDir := filepath.Join(targetDir, "static")
	if errWrite := os.WriteFile(targetPath, []byte("old binary"), 0o755); errWrite != nil {
		t.Fatalf("write old binary: %v", errWrite)
	}
	if errMkdir := os.MkdirAll(staticDir, 0o755); errMkdir != nil {
		t.Fatalf("create static dir: %v", errMkdir)
	}
	if errWrite := os.WriteFile(filepath.Join(staticDir, managementHTMLName), []byte("old panel"), 0o644); errWrite != nil {
		t.Fatalf("write old panel: %v", errWrite)
	}

	newBinary := []byte("new binary")
	newManagementHTML := []byte("<html>new management panel</html>")
	service := &Service{ManagementStaticDir: staticDir}
	managementPath, errInstall := service.installUpdate(buildUpdateArchive(t, newBinary, newManagementHTML), targetPath, "0.0.2")
	if errInstall != nil {
		t.Fatalf("installUpdate: %v", errInstall)
	}
	wantPanelPath := filepath.Join(staticDir, managementHTMLName)
	if managementPath != wantPanelPath {
		t.Fatalf("management panel path = %q, want %q", managementPath, wantPanelPath)
	}
	gotBinary, errRead := os.ReadFile(targetPath)
	if errRead != nil {
		t.Fatalf("read updated binary: %v", errRead)
	}
	if !bytes.Equal(gotBinary, newBinary) {
		t.Fatalf("updated binary = %q", gotBinary)
	}
	gotManagementHTML, errRead := os.ReadFile(wantPanelPath)
	if errRead != nil {
		t.Fatalf("read updated management panel: %v", errRead)
	}
	if !bytes.Equal(gotManagementHTML, newManagementHTML) {
		t.Fatalf("updated management panel = %q", gotManagementHTML)
	}
	markerPath := targetPath + ".version"
	markerData, errReadMarker := os.ReadFile(markerPath)
	if errReadMarker != nil {
		t.Fatalf("read version marker: %v", errReadMarker)
	}
	if string(markerData) != "0.0.2\n" {
		t.Fatalf("version marker = %q, want %q", markerData, "0.0.2\n")
	}
	markerInfo, errMarkerInfo := os.Stat(markerPath)
	if errMarkerInfo != nil {
		t.Fatalf("stat version marker: %v", errMarkerInfo)
	}
	panelInfo, errPanelInfo := os.Stat(wantPanelPath)
	if errPanelInfo != nil {
		t.Fatalf("stat management panel: %v", errPanelInfo)
	}
	if panelInfo.ModTime().Before(markerInfo.ModTime()) {
		t.Fatalf("management panel mtime %v is older than version marker %v", panelInfo.ModTime(), markerInfo.ModTime())
	}
}

func TestInstallUpdateWithoutManagementPanelWritesNoVersionMarker(t *testing.T) {
	targetDir := t.TempDir()
	targetPath := filepath.Join(targetDir, "CLIProxyAPI")
	if errWrite := os.WriteFile(targetPath, []byte("old binary"), 0o755); errWrite != nil {
		t.Fatalf("write old binary: %v", errWrite)
	}

	service := &Service{ManagementStaticDir: filepath.Join(targetDir, "static")}
	managementPath, errInstall := service.installUpdate(buildUpdateArchive(t, []byte("new binary"), nil), targetPath, "0.0.2")
	if errInstall != nil {
		t.Fatalf("installUpdate: %v", errInstall)
	}
	if managementPath != "" {
		t.Fatalf("management panel path = %q, want empty", managementPath)
	}
	if _, errMarker := os.Stat(targetPath + ".version"); !os.IsNotExist(errMarker) {
		t.Fatalf("version marker exists without a management panel: %v", errMarker)
	}
}

func TestPrepareUpdateInstallsManagementPanel(t *testing.T) {
	if !supportsInPlaceUpdate("linux") {
		t.Skip("in-place updates are not supported on this platform")
	}

	targetDir := t.TempDir()
	targetPath := filepath.Join(targetDir, "CLIProxyAPI")
	staticDir := filepath.Join(targetDir, "static")
	if errWrite := os.WriteFile(targetPath, []byte("old binary"), 0o755); errWrite != nil {
		t.Fatalf("write old binary: %v", errWrite)
	}
	if errMkdir := os.MkdirAll(staticDir, 0o755); errMkdir != nil {
		t.Fatalf("create static dir: %v", errMkdir)
	}
	if errWrite := os.WriteFile(filepath.Join(staticDir, managementHTMLName), []byte("old panel"), 0o644); errWrite != nil {
		t.Fatalf("write old panel: %v", errWrite)
	}

	newBinary := []byte("new binary")
	newManagementHTML := []byte("<html>new management panel</html>")
	archive := buildUpdateArchive(t, newBinary, newManagementHTML)
	archiveDigest := sha256.Sum256(archive)
	archiveName := "CLIProxyAPI_0.0.2_linux_amd64.tar.gz"
	checksums := fmt.Sprintf("%s  %s\n", hex.EncodeToString(archiveDigest[:]), archiveName)

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/example/CLIProxyAPI/releases/latest":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"tag_name":"v0.0.2","html_url":"https://example.com/releases/v0.0.2","assets":[{"name":%q,"browser_download_url":%q},{"name":"checksums.txt","browser_download_url":%q}]}`,
				archiveName, server.URL+"/archive", server.URL+"/checksums")
		case "/checksums":
			_, _ = w.Write([]byte(checksums))
		case "/archive":
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	service := &Service{
		Repository:          "example/CLIProxyAPI",
		APIBaseURL:          server.URL,
		HTTPClient:          server.Client(),
		CurrentVersion:      "0.0.1",
		GOOS:                "linux",
		GOARCH:              "amd64",
		Executable:          func() (string, error) { return targetPath, nil },
		ManagementStaticDir: staticDir,
	}
	result, errUpdate := service.PrepareUpdate(context.Background())
	if errUpdate != nil {
		t.Fatalf("PrepareUpdate: %v", errUpdate)
	}
	if result.Version != "0.0.2" {
		t.Fatalf("version = %q, want %q", result.Version, "0.0.2")
	}
	wantPanelPath := filepath.Join(staticDir, managementHTMLName)
	if result.ManagementPanelPath != wantPanelPath {
		t.Fatalf("management panel path = %q, want %q", result.ManagementPanelPath, wantPanelPath)
	}
	gotBinary, errRead := os.ReadFile(targetPath)
	if errRead != nil {
		t.Fatalf("read updated binary: %v", errRead)
	}
	if !bytes.Equal(gotBinary, newBinary) {
		t.Fatalf("updated binary = %q", gotBinary)
	}
	gotManagementHTML, errRead := os.ReadFile(wantPanelPath)
	if errRead != nil {
		t.Fatalf("read updated management panel: %v", errRead)
	}
	if !bytes.Equal(gotManagementHTML, newManagementHTML) {
		t.Fatalf("updated management panel = %q", gotManagementHTML)
	}
}

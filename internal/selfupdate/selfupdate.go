// Package selfupdate checks GitHub releases and installs a newer server binary.
package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo"
)

const (
	defaultAPIBaseURL       = "https://api.github.com"
	maxReleaseResponseBytes = 1 << 20
	maxChecksumsBytes       = 1 << 20
	maxUpdateAssetBytes     = 256 << 20
	maxManagementHTMLBytes  = 50 << 20
	checksumsAssetName      = "checksums.txt"
	managementHTMLName      = "management.html"
)

var (
	// ErrAlreadyLatest indicates that the running version is already current.
	ErrAlreadyLatest = errors.New("current version is already the latest")

	// ErrNoReleases indicates that the repository has not published a release yet.
	ErrNoReleases = errors.New("repository has no published releases")

	// ErrUnsupported indicates that in-place updates are unavailable on this platform.
	ErrUnsupported = errors.New("in-place updates are not supported on this platform")
)

// Asset is one downloadable file attached to a GitHub release.
type Asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	Digest             string `json:"digest"`
}

// Release is the subset of GitHub release metadata used by the updater.
type Release struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	HTMLURL     string    `json:"html_url"`
	Body        string    `json:"body"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []Asset   `json:"assets"`
}

// Status describes the current version and the latest published release.
type Status struct {
	CurrentVersion  string
	LatestVersion   string
	UpdateAvailable bool
	CanUpdate       bool
	ReleaseURL      string
	ReleaseNotes    string
	PublishedAt     time.Time
}

// Result describes a successfully staged update.
type Result struct {
	Version             string
	TargetPath          string
	ManagementPanelPath string
}

// Service performs release checks and stages binary updates.
type Service struct {
	Repository          string
	APIBaseURL          string
	HTTPClient          *http.Client
	Token               string
	CurrentVersion      string
	GOOS                string
	GOARCH              string
	Executable          func() (string, error)
	ManagementStaticDir string
}

// New creates a release service with production defaults.
func New(repository string, client *http.Client, token string) *Service {
	if strings.TrimSpace(repository) == "" {
		repository = buildinfo.UpdateRepository
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Minute}
	}
	return &Service{
		Repository:     repository,
		APIBaseURL:     defaultAPIBaseURL,
		HTTPClient:     client,
		Token:          token,
		CurrentVersion: buildinfo.Version,
		GOOS:           runtime.GOOS,
		GOARCH:         runtime.GOARCH,
	}
}

// Check returns the current version, latest release, and update availability.
func (s *Service) Check(ctx context.Context) (Status, error) {
	_, status, errInspect := s.inspect(ctx)
	return status, errInspect
}

// PrepareUpdate downloads and verifies the latest release, then stages it as the
// active executable. The caller is responsible for restarting the process.
func (s *Service) PrepareUpdate(ctx context.Context) (Result, error) {
	release, status, errInspect := s.inspect(ctx)
	if errInspect != nil {
		return Result{}, errInspect
	}
	if !status.UpdateAvailable {
		return Result{}, ErrAlreadyLatest
	}
	if !supportsInPlaceUpdate(s.goos()) {
		return Result{}, ErrUnsupported
	}

	asset, okAsset := selectReleaseAsset(release, s.goos(), s.goarch())
	if !okAsset {
		return Result{}, fmt.Errorf("release %s has no asset for %s/%s", status.LatestVersion, s.goos(), s.goarch())
	}
	checksumAsset, okChecksum := findAsset(release, checksumsAssetName)
	if !okChecksum {
		return Result{}, errors.New("release does not provide checksums.txt")
	}

	checksumsData, errChecksums := s.download(ctx, checksumAsset.BrowserDownloadURL, maxChecksumsBytes)
	if errChecksums != nil {
		return Result{}, fmt.Errorf("download checksums: %w", errChecksums)
	}
	wantDigest, errDigest := checksumFor(asset.Name, checksumsData)
	if errDigest != nil {
		return Result{}, errDigest
	}

	assetData, errDownload := s.download(ctx, asset.BrowserDownloadURL, maxUpdateAssetBytes)
	if errDownload != nil {
		return Result{}, fmt.Errorf("download update asset: %w", errDownload)
	}
	gotDigest := sha256.Sum256(assetData)
	if !strings.EqualFold(hex.EncodeToString(gotDigest[:]), wantDigest) {
		return Result{}, errors.New("update asset checksum mismatch")
	}

	targetPath, errTarget := s.executablePath()
	if errTarget != nil {
		return Result{}, errTarget
	}
	managementPath, errInstall := s.installUpdate(assetData, targetPath, status.LatestVersion)
	if errInstall != nil {
		return Result{}, errInstall
	}
	return Result{
		Version:             status.LatestVersion,
		TargetPath:          targetPath,
		ManagementPanelPath: managementPath,
	}, nil
}

func (s *Service) installUpdate(assetData []byte, targetPath string, version string) (string, error) {
	stagedPath, managementHTML, errExtract := extractUpdate(assetData, filepath.Dir(targetPath))
	if errExtract != nil {
		return "", errExtract
	}
	if errInstall := installBinary(stagedPath, targetPath); errInstall != nil {
		_ = os.Remove(stagedPath)
		return "", errInstall
	}
	if len(managementHTML) == 0 {
		return "", nil
	}
	if errVersion := writeVersionMarker(targetPath, version); errVersion != nil {
		rollbackBinary(targetPath)
		return "", errVersion
	}
	managementPath, stagedManagementPath, errStageManagement := stageManagementHTML(s.managementStaticDir(targetPath), managementHTML)
	if errStageManagement != nil {
		rollbackBinary(targetPath)
		return "", errStageManagement
	}
	if errInstallManagement := os.Rename(stagedManagementPath, managementPath); errInstallManagement != nil {
		rollbackBinary(targetPath)
		_ = os.Remove(stagedManagementPath)
		return "", fmt.Errorf("install management panel: %w", errInstallManagement)
	}
	return managementPath, nil
}

// Restart replaces the current process with the staged executable.
func (s *Service) Restart(targetPath string) error {
	if !supportsInPlaceUpdate(s.goos()) {
		return ErrUnsupported
	}
	return restartProcess(targetPath)
}

func (s *Service) inspect(ctx context.Context) (Release, Status, error) {
	release, errRelease := s.latestRelease(ctx)
	if errRelease != nil {
		if errors.Is(errRelease, ErrNoReleases) {
			current := strings.TrimSpace(s.currentVersion())
			return Release{}, Status{
				CurrentVersion:  current,
				LatestVersion:   current,
				UpdateAvailable: false,
				CanUpdate:       false,
				ReleaseURL:      "https://github.com/" + strings.TrimSpace(s.Repository) + "/releases",
			}, nil
		}
		return Release{}, Status{}, errRelease
	}
	current := strings.TrimSpace(s.currentVersion())
	latest := releaseVersion(release)
	if latest == "" {
		return Release{}, Status{}, errors.New("latest release does not contain a version")
	}
	updateAvailable := compareVersions(latest, current) > 0
	_, hasAsset := selectReleaseAsset(release, s.goos(), s.goarch())
	status := Status{
		CurrentVersion:  current,
		LatestVersion:   latest,
		UpdateAvailable: updateAvailable,
		CanUpdate:       updateAvailable && hasAsset && supportsInPlaceUpdate(s.goos()),
		ReleaseURL:      strings.TrimSpace(release.HTMLURL),
		ReleaseNotes:    strings.TrimSpace(release.Body),
		PublishedAt:     release.PublishedAt,
	}
	return release, status, nil
}

func (s *Service) latestRelease(ctx context.Context) (Release, error) {
	repository := strings.TrimSpace(s.Repository)
	if repository == "" {
		return Release{}, errors.New("update repository is not configured")
	}
	baseURL := strings.TrimSpace(s.APIBaseURL)
	if baseURL == "" {
		baseURL = defaultAPIBaseURL
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/repos/" + repository + "/releases/latest"
	req, errRequest := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if errRequest != nil {
		return Release{}, fmt.Errorf("create release request: %w", errRequest)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "CLIProxyAPI")
	if token := strings.TrimSpace(s.Token); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, errDo := s.httpClient().Do(req)
	if errDo != nil {
		return Release{}, fmt.Errorf("request latest release: %w", errDo)
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode == http.StatusNotFound {
		return Release{}, ErrNoReleases
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return Release{}, fmt.Errorf("latest release request returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var release Release
	if errDecode := json.NewDecoder(io.LimitReader(resp.Body, maxReleaseResponseBytes)).Decode(&release); errDecode != nil {
		return Release{}, fmt.Errorf("decode latest release: %w", errDecode)
	}
	return release, nil
}

func (s *Service) download(ctx context.Context, url string, maxBytes int64) ([]byte, error) {
	if strings.TrimSpace(url) == "" {
		return nil, errors.New("download URL is empty")
	}
	req, errRequest := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if errRequest != nil {
		return nil, errRequest
	}
	req.Header.Set("User-Agent", "CLIProxyAPI")
	if token := strings.TrimSpace(s.Token); token != "" && strings.Contains(req.URL.Host, "github.com") {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, errDo := s.httpClient().Do(req)
	if errDo != nil {
		return nil, errDo
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("download returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	data, errRead := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if errRead != nil {
		return nil, errRead
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("download exceeds %d bytes", maxBytes)
	}
	return data, nil
}

func (s *Service) executablePath() (string, error) {
	executable := s.Executable
	if executable == nil {
		executable = os.Executable
	}
	target, errExecutable := executable()
	if errExecutable != nil {
		return "", fmt.Errorf("resolve executable: %w", errExecutable)
	}
	resolved, errResolve := filepath.EvalSymlinks(target)
	if errResolve != nil {
		return "", fmt.Errorf("resolve executable symlink: %w", errResolve)
	}
	absolute, errAbsolute := filepath.Abs(resolved)
	if errAbsolute != nil {
		return "", fmt.Errorf("resolve executable path: %w", errAbsolute)
	}
	return absolute, nil
}

func (s *Service) currentVersion() string {
	if version := strings.TrimSpace(s.CurrentVersion); version != "" {
		return version
	}
	return buildinfo.Version
}

func (s *Service) goos() string {
	if value := strings.TrimSpace(s.GOOS); value != "" {
		return value
	}
	return runtime.GOOS
}

func (s *Service) goarch() string {
	if value := strings.TrimSpace(s.GOARCH); value != "" {
		return value
	}
	return runtime.GOARCH
}

func (s *Service) httpClient() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return http.DefaultClient
}

func (s *Service) managementStaticDir(targetPath string) string {
	if staticDir := strings.TrimSpace(s.ManagementStaticDir); staticDir != "" {
		return filepath.Clean(staticDir)
	}
	return filepath.Join(filepath.Dir(targetPath), "static")
}

func releaseVersion(release Release) string {
	version := strings.TrimSpace(release.TagName)
	if version == "" {
		version = strings.TrimSpace(release.Name)
	}
	return normalizeVersion(version)
}

func selectReleaseAsset(release Release, goos, goarch string) (Asset, bool) {
	for _, name := range releaseAssetNames(releaseVersion(release), goos, goarch) {
		if asset, ok := findAsset(release, name); ok {
			return asset, true
		}
	}
	return Asset{}, false
}

func releaseAssetNames(version, goos, goarch string) []string {
	base := fmt.Sprintf("CLIProxyAPI_%s_%s_%s", normalizeVersion(version), goos, goarch)
	if goos == "windows" {
		return []string{base + ".zip"}
	}
	names := []string{base + ".tar.gz"}
	if goos == "linux" {
		names = append(names, base+"_no-plugin.tar.gz")
	}
	return names
}

func findAsset(release Release, name string) (Asset, bool) {
	for _, asset := range release.Assets {
		if asset.Name == name {
			return asset, true
		}
	}
	return Asset{}, false
}

func checksumFor(assetName string, data []byte) (string, error) {
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		if path.Base(name) != assetName {
			continue
		}
		digest := strings.ToLower(fields[0])
		if len(digest) != sha256.Size*2 {
			return "", fmt.Errorf("invalid checksum for %s", assetName)
		}
		if _, errDecode := hex.DecodeString(digest); errDecode != nil {
			return "", fmt.Errorf("invalid checksum for %s: %w", assetName, errDecode)
		}
		return digest, nil
	}
	return "", fmt.Errorf("checksums.txt does not contain %s", assetName)
}

func extractUpdate(archive []byte, targetDir string) (string, []byte, error) {
	gzipReader, errGzip := gzip.NewReader(bytes.NewReader(archive))
	if errGzip != nil {
		return "", nil, fmt.Errorf("open update archive: %w", errGzip)
	}
	defer func() {
		_ = gzipReader.Close()
	}()
	tarReader := tar.NewReader(gzipReader)
	var stagedPath string
	var managementHTML []byte
	for {
		header, errNext := tarReader.Next()
		if errors.Is(errNext, io.EOF) {
			break
		}
		if errNext != nil {
			if stagedPath != "" {
				_ = os.Remove(stagedPath)
			}
			return "", nil, fmt.Errorf("read update archive: %w", errNext)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		baseName := path.Base(header.Name)
		if baseName == "CLIProxyAPI" && stagedPath == "" {
			if header.Size <= 0 || header.Size > maxUpdateAssetBytes {
				return "", nil, errors.New("update binary has an invalid size")
			}
			tempFile, errTemp := os.CreateTemp(targetDir, ".CLIProxyAPI.update-*")
			if errTemp != nil {
				return "", nil, fmt.Errorf("create staged update file: %w", errTemp)
			}
			tempPath := tempFile.Name()
			written, errCopy := io.Copy(tempFile, tarReader)
			if errClose := tempFile.Close(); errClose != nil && errCopy == nil {
				errCopy = errClose
			}
			if errCopy != nil {
				_ = os.Remove(tempPath)
				return "", nil, fmt.Errorf("write staged update file: %w", errCopy)
			}
			if written != header.Size {
				_ = os.Remove(tempPath)
				return "", nil, fmt.Errorf("update binary size mismatch: expected %d got %d", header.Size, written)
			}
			if errChmod := os.Chmod(tempPath, 0o755); errChmod != nil {
				_ = os.Remove(tempPath)
				return "", nil, fmt.Errorf("make staged update executable: %w", errChmod)
			}
			stagedPath = tempPath
			continue
		}
		if baseName == managementHTMLName && managementHTML == nil {
			if header.Size <= 0 || header.Size > maxManagementHTMLBytes {
				if stagedPath != "" {
					_ = os.Remove(stagedPath)
				}
				return "", nil, errors.New("management panel has an invalid size")
			}
			data, errRead := io.ReadAll(io.LimitReader(tarReader, maxManagementHTMLBytes+1))
			if errRead != nil {
				if stagedPath != "" {
					_ = os.Remove(stagedPath)
				}
				return "", nil, fmt.Errorf("read management panel: %w", errRead)
			}
			if int64(len(data)) != header.Size {
				if stagedPath != "" {
					_ = os.Remove(stagedPath)
				}
				return "", nil, fmt.Errorf("management panel size mismatch: expected %d got %d", header.Size, len(data))
			}
			managementHTML = data
		}
	}
	if stagedPath == "" {
		return "", nil, errors.New("update archive does not contain CLIProxyAPI")
	}
	return stagedPath, managementHTML, nil
}

func stageManagementHTML(staticDir string, data []byte) (string, string, error) {
	if len(data) == 0 {
		return "", "", nil
	}
	if errMkdirAll := os.MkdirAll(staticDir, 0o755); errMkdirAll != nil {
		return "", "", fmt.Errorf("prepare management panel directory: %w", errMkdirAll)
	}
	finalPath := filepath.Join(staticDir, managementHTMLName)
	tempFile, errTemp := os.CreateTemp(staticDir, ".management.html.update-*")
	if errTemp != nil {
		return "", "", fmt.Errorf("stage management panel: %w", errTemp)
	}
	tempPath := tempFile.Name()
	_, errWrite := tempFile.Write(data)
	if errClose := tempFile.Close(); errClose != nil && errWrite == nil {
		errWrite = errClose
	}
	if errWrite != nil {
		_ = os.Remove(tempPath)
		return "", "", fmt.Errorf("write staged management panel: %w", errWrite)
	}
	if errChmod := os.Chmod(tempPath, 0o644); errChmod != nil {
		_ = os.Remove(tempPath)
		return "", "", fmt.Errorf("set management panel permissions: %w", errChmod)
	}
	return finalPath, tempPath, nil
}

func rollbackBinary(targetPath string) {
	_ = os.Remove(targetPath + ".version")
	backupPath := targetPath + ".bak"
	if _, errStat := os.Stat(backupPath); errStat != nil {
		return
	}
	_ = os.Remove(targetPath)
	_ = os.Rename(backupPath, targetPath)
}

func installBinary(stagedPath, targetPath string) error {
	backupPath := targetPath + ".bak"
	_ = os.Remove(backupPath)
	if errBackup := os.Rename(targetPath, backupPath); errBackup != nil {
		return fmt.Errorf("backup current executable: %w", errBackup)
	}
	if errInstall := os.Rename(stagedPath, targetPath); errInstall != nil {
		_ = os.Rename(backupPath, targetPath)
		return fmt.Errorf("install updated executable: %w", errInstall)
	}
	if errChmod := os.Chmod(targetPath, 0o755); errChmod != nil {
		_ = os.Remove(targetPath)
		_ = os.Rename(backupPath, targetPath)
		return fmt.Errorf("make updated executable runnable: %w", errChmod)
	}
	return nil
}

func writeVersionMarker(targetPath, version string) error {
	if errVersion := os.WriteFile(targetPath+".version", []byte(normalizeVersion(version)+"\n"), 0o644); errVersion != nil {
		return fmt.Errorf("write updated version marker: %w", errVersion)
	}
	return nil
}

func normalizeVersion(version string) string {
	version = strings.TrimSpace(version)
	if len(version) > 1 && (version[0] == 'v' || version[0] == 'V') {
		return version[1:]
	}
	return version
}

func compareVersions(a, b string) int {
	partsA, okA := numericVersionParts(a)
	partsB, okB := numericVersionParts(b)
	if !okA || !okB {
		return 0
	}
	length := len(partsA)
	if len(partsB) > length {
		length = len(partsB)
	}
	for index := 0; index < length; index++ {
		valueA := int64(0)
		if index < len(partsA) {
			valueA = partsA[index]
		}
		valueB := int64(0)
		if index < len(partsB) {
			valueB = partsB[index]
		}
		if valueA < valueB {
			return -1
		}
		if valueA > valueB {
			return 1
		}
	}
	return 0
}

func numericVersionParts(version string) ([]int64, bool) {
	version = normalizeVersion(version)
	if version == "" {
		return nil, false
	}
	if index := strings.IndexAny(version, "-+"); index >= 0 {
		version = version[:index]
	}
	segments := strings.Split(version, ".")
	parts := make([]int64, 0, len(segments))
	for _, segment := range segments {
		if segment == "" {
			return nil, false
		}
		value, errParse := strconv.ParseInt(segment, 10, 64)
		if errParse != nil || value < 0 {
			return nil, false
		}
		parts = append(parts, value)
	}
	return parts, true
}

package management

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/managementasset"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/processrestart"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/selfupdate"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
	log "github.com/sirupsen/logrus"
)

const (
	updateCheckTimeout = 30 * time.Second
	updateApplyTimeout = 10 * time.Minute
	updateRestartDelay = 1500 * time.Millisecond
)

var (
	serverLifecycleMu sync.Mutex
	serverStartedAt   = time.Now().UTC()
)

type serverVersionResponse struct {
	Version    string `json:"version"`
	Commit     string `json:"commit"`
	BuildDate  string `json:"build_date"`
	Repository string `json:"repository"`
	StartedAt  string `json:"started_at"`
}

type serverUpdateStatusResponse struct {
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	UpdateAvailable bool   `json:"update_available"`
	CanUpdate       bool   `json:"can_update"`
	ReleaseURL      string `json:"release_url,omitempty"`
	ReleaseNotes    string `json:"release_notes,omitempty"`
	PublishedAt     string `json:"published_at,omitempty"`
}

// GetServerVersion returns the running server's build metadata.
func (h *Handler) GetServerVersion(c *gin.Context) {
	c.JSON(http.StatusOK, serverVersionResponse{
		Version:    buildinfo.Version,
		Commit:     buildinfo.Commit,
		BuildDate:  buildinfo.BuildDate,
		Repository: buildinfo.UpdateRepository,
		StartedAt:  serverStartedAt.Format(time.RFC3339Nano),
	})
}

// GetServerUpdate checks GitHub releases for a newer server build.
func (h *Handler) GetServerUpdate(c *gin.Context) {
	service := h.newUpdateService(updateCheckTimeout)
	status, errCheck := service.Check(c.Request.Context())
	if errCheck != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "update_check_failed",
			"message": errCheck.Error(),
		})
		return
	}
	response := serverUpdateStatusResponse{
		CurrentVersion:  status.CurrentVersion,
		LatestVersion:   status.LatestVersion,
		UpdateAvailable: status.UpdateAvailable,
		CanUpdate:       status.CanUpdate,
		ReleaseURL:      status.ReleaseURL,
		ReleaseNotes:    status.ReleaseNotes,
	}
	if !status.PublishedAt.IsZero() {
		response.PublishedAt = status.PublishedAt.UTC().Format(time.RFC3339)
	}
	c.JSON(http.StatusOK, response)
}

// RestartServer relaunches the current process with its existing arguments
// after the HTTP response has been flushed.
func (h *Handler) RestartServer(c *gin.Context) {
	if !serverLifecycleMu.TryLock() {
		c.JSON(http.StatusConflict, gin.H{
			"error":   "server_operation_in_progress",
			"message": "another server update or restart is already running",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"restarting": true,
		"message":    "server is restarting",
	})
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}

	go func() {
		timer := time.NewTimer(updateRestartDelay)
		defer timer.Stop()
		<-timer.C
		log.Info("management: restarting server")
		if errRestart := processrestart.Restart(); errRestart != nil {
			serverLifecycleMu.Unlock()
			log.WithError(errRestart).Error("management: failed to restart server")
			return
		}
		os.Exit(0)
	}()
}

// ApplyServerUpdate downloads, verifies, installs the latest release, then
// restarts the process after the HTTP response has been flushed.
func (h *Handler) ApplyServerUpdate(c *gin.Context) {
	if !serverLifecycleMu.TryLock() {
		c.JSON(http.StatusConflict, gin.H{
			"error":   "update_in_progress",
			"message": "another server update is already running",
		})
		return
	}
	defer serverLifecycleMu.Unlock()

	service := h.newUpdateService(updateApplyTimeout)
	ctx := c.Request.Context()
	if ctx != nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.WithoutCancel(ctx), updateApplyTimeout)
		defer cancel()
	}
	result, errUpdate := service.PrepareUpdate(ctx)
	if errUpdate != nil {
		switch {
		case errors.Is(errUpdate, selfupdate.ErrAlreadyLatest):
			c.JSON(http.StatusConflict, gin.H{
				"error":   "already_latest",
				"message": errUpdate.Error(),
			})
		case errors.Is(errUpdate, selfupdate.ErrUnsupported):
			c.JSON(http.StatusConflict, gin.H{
				"error":   "update_unsupported",
				"message": errUpdate.Error(),
			})
		default:
			c.JSON(http.StatusBadGateway, gin.H{
				"error":   "update_failed",
				"message": errUpdate.Error(),
			})
		}
		return
	}

	log.WithFields(log.Fields{
		"version":         result.Version,
		"management_html": result.ManagementPanelPath,
	}).Info("self-update: installed new server version, restarting")
	if result.ManagementPanelPath == "" {
		log.Warn("self-update: release did not contain management.html; keeping the existing management panel")
	}
	c.JSON(http.StatusOK, gin.H{
		"updated": true,
		"version": result.Version,
		"message": "update installed; server is restarting",
	})
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}

	go func() {
		timer := time.NewTimer(updateRestartDelay)
		defer timer.Stop()
		<-timer.C
		if errRestart := service.Restart(result.TargetPath); errRestart != nil {
			log.WithError(errRestart).Error("self-update: failed to restart server")
		}
	}()
}

func (h *Handler) newUpdateService(timeout time.Duration) *selfupdate.Service {
	proxyURL := ""
	managementStaticDir := ""
	if h != nil {
		managementStaticDir = managementasset.StaticDir(h.configFilePath)
		if cfg := h.configSnapshot(); cfg != nil {
			proxyURL = strings.TrimSpace(cfg.ProxyURL)
		}
	}
	client := &http.Client{Timeout: timeout}
	if proxyURL != "" {
		util.SetProxy(&sdkconfig.SDKConfig{ProxyURL: proxyURL}, client)
	}
	service := selfupdate.New(buildinfo.UpdateRepository, client, util.ResolveGitHubToken())
	service.ManagementStaticDir = managementStaticDir
	return service
}

//go:build windows

// Package processrestart relaunches the current server with its existing
// command-line arguments.
package processrestart

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

const (
	restartHelperEnv   = "CLIPROXYAPI_RESTART_HELPER"
	restartHelperDelay = 750 * time.Millisecond
)

type restartHelperSpec struct {
	ParentPID  int      `json:"parent_pid"`
	Executable string   `json:"executable"`
	Args       []string `json:"args"`
	WorkingDir string   `json:"working_dir"`
}

// Restart launches a short-lived helper. The helper waits for this process to
// exit before starting the replacement, which releases the listening port.
func Restart() error {
	executable, errExecutable := os.Executable()
	if errExecutable != nil {
		return fmt.Errorf("resolve current executable: %w", errExecutable)
	}
	executable, errExecutable = filepath.Abs(executable)
	if errExecutable != nil {
		return fmt.Errorf("resolve executable path: %w", errExecutable)
	}
	workingDir, errWorkingDir := os.Getwd()
	if errWorkingDir != nil {
		return fmt.Errorf("resolve working directory: %w", errWorkingDir)
	}

	payload, errMarshal := json.Marshal(restartHelperSpec{
		ParentPID:  os.Getpid(),
		Executable: executable,
		Args:       append([]string(nil), os.Args[1:]...),
		WorkingDir: workingDir,
	})
	if errMarshal != nil {
		return fmt.Errorf("encode restart helper payload: %w", errMarshal)
	}

	helper := exec.Command(executable, os.Args[1:]...)
	helper.Dir = workingDir
	helper.Env = append(environmentWithout(restartHelperEnv), restartHelperEnv+"="+base64.RawURLEncoding.EncodeToString(payload))
	helper.Stdin = os.Stdin
	helper.Stdout = os.Stdout
	helper.Stderr = os.Stderr
	if errStart := helper.Start(); errStart != nil {
		return fmt.Errorf("start restart helper: %w", errStart)
	}
	_ = helper.Process.Release()
	return nil
}

// RunHelperIfRequested waits for the old process and then starts its
// replacement. It must be called at the beginning of main.
func RunHelperIfRequested() (bool, error) {
	encoded := strings.TrimSpace(os.Getenv(restartHelperEnv))
	if encoded == "" {
		return false, nil
	}
	if errUnset := os.Unsetenv(restartHelperEnv); errUnset != nil {
		return true, fmt.Errorf("clear restart helper environment: %w", errUnset)
	}

	payload, errDecode := base64.RawURLEncoding.DecodeString(encoded)
	if errDecode != nil {
		return true, fmt.Errorf("decode restart helper payload: %w", errDecode)
	}
	var spec restartHelperSpec
	if errUnmarshal := json.Unmarshal(payload, &spec); errUnmarshal != nil {
		return true, fmt.Errorf("parse restart helper payload: %w", errUnmarshal)
	}
	if spec.ParentPID <= 0 || strings.TrimSpace(spec.Executable) == "" {
		return true, errors.New("restart helper payload is incomplete")
	}

	if errWait := waitForProcessExit(spec.ParentPID); errWait != nil {
		return true, errWait
	}
	time.Sleep(restartHelperDelay)

	replacement := exec.Command(spec.Executable, spec.Args...)
	replacement.Dir = spec.WorkingDir
	replacement.Env = environmentWithout(restartHelperEnv)
	replacement.Stdin = os.Stdin
	replacement.Stdout = os.Stdout
	replacement.Stderr = os.Stderr
	if errStart := replacement.Start(); errStart != nil {
		return true, fmt.Errorf("start replacement process: %w", errStart)
	}
	_ = replacement.Process.Release()
	return true, nil
}

func waitForProcessExit(pid int) error {
	handle, errOpen := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if errOpen != nil {
		if errors.Is(errOpen, windows.ERROR_INVALID_PARAMETER) {
			return nil
		}
		return fmt.Errorf("open previous process: %w", errOpen)
	}
	defer func() {
		_ = windows.CloseHandle(handle)
	}()
	if _, errWait := windows.WaitForSingleObject(handle, ^uint32(0)); errWait != nil {
		return fmt.Errorf("wait for previous process: %w", errWait)
	}
	return nil
}

func environmentWithout(key string) []string {
	prefix := key + "="
	current := os.Environ()
	environment := make([]string, 0, len(current))
	for _, entry := range current {
		if !strings.HasPrefix(entry, prefix) {
			environment = append(environment, entry)
		}
	}
	return environment
}

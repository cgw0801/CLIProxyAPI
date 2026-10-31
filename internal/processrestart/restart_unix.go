//go:build !windows

// Package processrestart relaunches the current server with its existing
// command-line arguments.
package processrestart

import (
	"fmt"
	"os"
	"syscall"
)

// Restart replaces the current process image with a fresh copy that keeps the
// original command-line arguments and working directory.
func Restart() error {
	executable, errExecutable := os.Executable()
	if errExecutable != nil {
		return fmt.Errorf("resolve current executable: %w", errExecutable)
	}
	argv := append([]string{executable}, os.Args[1:]...)
	if errExec := syscall.Exec(executable, argv, os.Environ()); errExec != nil {
		return fmt.Errorf("exec replacement process: %w", errExec)
	}
	return nil
}

// RunHelperIfRequested is only needed by the Windows restart implementation.
func RunHelperIfRequested() (bool, error) {
	return false, nil
}

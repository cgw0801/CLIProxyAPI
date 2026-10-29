//go:build linux || darwin

package selfupdate

import (
	"os"
	"syscall"
)

func supportsInPlaceUpdate(goos string) bool {
	return goos == "linux" || goos == "darwin"
}

func restartProcess(targetPath string) error {
	argv := append([]string{targetPath}, os.Args[1:]...)
	return syscall.Exec(targetPath, argv, os.Environ())
}

//go:build windows

package selfupdate

func supportsInPlaceUpdate(goos string) bool {
	return false
}

func restartProcess(targetPath string) error {
	return ErrUnsupported
}

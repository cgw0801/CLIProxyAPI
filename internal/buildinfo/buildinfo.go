// Package buildinfo exposes compile-time metadata shared across the server.
package buildinfo

const (
	// DefaultVersion is the release version used by development and container builds.
	DefaultVersion = "0.0.3"

	// UpdateRepository is the GitHub repository that publishes application releases.
	UpdateRepository = "cgw0801/CLIProxyAPI"
)

// The following variables are overridden via ldflags during release builds.
// Defaults cover local development builds.
var (
	// Version is the semantic version or git describe output of the binary.
	Version = DefaultVersion

	// Commit is the git commit SHA baked into the binary.
	Commit = "none"

	// BuildDate records when the binary was built in UTC.
	BuildDate = "unknown"
)

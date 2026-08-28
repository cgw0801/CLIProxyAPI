package api

import (
	"bytes"
	"testing"
)

func TestInjectModelACLShortcut(t *testing.T) {
	page := []byte("<html><body><main>panel</main></body></html>")
	got := injectModelACLShortcut(page)
	if !bytes.Contains(got, []byte(`href="/model-acl.html"`)) {
		t.Fatalf("shortcut missing: %s", got)
	}
	if !bytes.Contains(got, []byte("模型分配")) {
		t.Fatalf("label missing: %s", got)
	}
	if !bytes.Contains(got, []byte(`id="model-acl-shortcut"`)) || !bytes.Contains(got, []byte(`style="display:none;`)) {
		t.Fatalf("shortcut must be hidden before authentication: %s", got)
	}
	if !bytes.Contains(got, []byte(`route === "/login"`)) || !bytes.Contains(got, []byte(`root.querySelector(".sidebar")`)) {
		t.Fatalf("shortcut authentication guard missing: %s", got)
	}
	if !bytes.Contains(got, []byte(`new MutationObserver(syncShortcut)`)) || !bytes.Contains(got, []byte(`window.addEventListener("hashchange", syncShortcut)`)) {
		t.Fatalf("shortcut does not follow login state changes: %s", got)
	}
}

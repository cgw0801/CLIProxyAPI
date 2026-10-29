package management

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseMonitoringQueryPagination(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/?page=3&page_size=50", nil)

	options, errParse := parseMonitoringQuery(c)
	if errParse != nil {
		t.Fatalf("parseMonitoringQuery: %v", errParse)
	}
	if options.Page != 3 || options.Limit != 50 || options.Offset != 100 {
		t.Fatalf("unexpected pagination options: %+v", options)
	}
}

func TestParseMonitoringQueryRejectsInvalidPage(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/?page=0", nil)

	if _, errParse := parseMonitoringQuery(c); errParse == nil {
		t.Fatal("expected invalid page error")
	}
}

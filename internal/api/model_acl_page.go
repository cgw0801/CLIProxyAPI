package api

import (
	"bytes"
	"net/http"

	"github.com/gin-gonic/gin"
)

const modelACLShortcutHTML = `<a id="model-acl-shortcut" href="/model-acl.html" title="按 API Key 分配可用模型" aria-hidden="true" tabindex="-1" style="display:none;position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:10px 16px;border-radius:999px;background:#2563eb;color:#fff;font:600 14px/20px system-ui,-apple-system,'Segoe UI',sans-serif;text-decoration:none;box-shadow:0 8px 24px rgba(37,99,235,.35)">模型分配</a>
<script id="model-acl-shortcut-controller">
(function () {
  "use strict";
  var shortcut = document.getElementById("model-acl-shortcut");
  var root = document.getElementById("root");
  if (!shortcut || !root) return;

  function syncShortcut() {
    var route = window.location.hash.replace(/^#/, "").split("?")[0];
    var isLoginRoute = route === "/login" || route.indexOf("/login/") === 0;
    var isAuthenticated = !isLoginRoute && root.querySelector(".sidebar") !== null;
    shortcut.style.display = isAuthenticated ? "inline-flex" : "none";
    shortcut.setAttribute("aria-hidden", isAuthenticated ? "false" : "true");
    shortcut.tabIndex = isAuthenticated ? 0 : -1;
  }

  new MutationObserver(syncShortcut).observe(root, { childList:true, subtree:true });
  window.addEventListener("hashchange", syncShortcut);
  syncShortcut();
}());
</script>`

func injectModelACLShortcut(page []byte) []byte {
	marker := []byte("</body>")
	index := bytes.LastIndex(page, marker)
	if index < 0 {
		return page
	}
	out := make([]byte, 0, len(page)+len(modelACLShortcutHTML))
	out = append(out, page[:index]...)
	out = append(out, modelACLShortcutHTML...)
	out = append(out, page[index:]...)
	return out
}

func (s *Server) serveModelACLControlPanel(c *gin.Context) {
	cfg := s.cfg
	if cfg == nil || cfg.Home.Enabled || cfg.RemoteManagement.DisableControlPanel {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(modelACLControlPanelHTML))
}

const modelACLControlPanelHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>模型分配 · CLIProxyAPI</title>
  <style>
    :root { color-scheme: dark; --bg:#07101f; --panel:#101a2d; --panel2:#15223a; --line:#263653; --text:#e8eef9; --muted:#93a4bf; --primary:#60a5fa; --primary2:#2563eb; --danger:#fb7185; --ok:#34d399; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at 15% 0,#14254a 0,transparent 34%),var(--bg); color:var(--text); font:14px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
    button,input,select { font:inherit; }
    button { cursor:pointer; }
    .shell { width:min(1180px,calc(100% - 32px)); margin:0 auto; padding:28px 0 56px; }
    header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:22px; }
    h1 { margin:0; font-size:27px; letter-spacing:-.02em; }
    h2,h3,p { margin-top:0; }
    .subtitle { margin:6px 0 0; color:var(--muted); }
    .header-actions,.row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .panel { background:rgba(16,26,45,.94); border:1px solid var(--line); border-radius:16px; box-shadow:0 16px 50px rgba(0,0,0,.22); }
    .login { max-width:520px; margin:9vh auto 0; padding:26px; }
    .login h2 { margin-bottom:8px; }
    .login p { color:var(--muted); }
    label.caption { display:block; color:var(--muted); margin:14px 0 7px; font-weight:600; }
    input,select { min-height:40px; border:1px solid var(--line); border-radius:9px; background:#0a1426; color:var(--text); padding:8px 11px; outline:none; }
    input:focus,select:focus { border-color:var(--primary); box-shadow:0 0 0 3px rgba(96,165,250,.13); }
    input.grow { flex:1 1 260px; width:100%; }
    .btn { min-height:40px; border:1px solid var(--line); border-radius:9px; padding:8px 14px; background:var(--panel2); color:var(--text); font-weight:650; }
    .btn:hover { border-color:#496287; }
    .btn.primary { background:var(--primary2); border-color:var(--primary2); color:#fff; }
    .btn.danger { color:#fecdd3; border-color:#713345; background:#321625; }
    .btn.small { min-height:34px; padding:5px 10px; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:15px 17px; margin-bottom:14px; }
    .stats { color:var(--muted); }
    .stats strong { color:var(--text); }
    .keys { display:grid; gap:14px; }
    .key-card { padding:17px; }
    .key-head { display:grid; grid-template-columns:minmax(240px,1fr) auto auto; gap:10px; align-items:center; }
    .key-input { width:100%; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
    .mode { min-width:142px; }
    .assignment { margin-top:15px; border-top:1px solid var(--line); padding-top:15px; }
    .assignment-top { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; }
    .assignment-top p { margin:0; color:var(--muted); }
    .model-tools { display:flex; gap:9px; margin-bottom:10px; }
    .model-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(255px,1fr)); gap:7px; max-height:310px; overflow:auto; padding:2px; }
    .model { display:flex; gap:9px; align-items:flex-start; border:1px solid var(--line); background:#0b1628; border-radius:9px; padding:9px 10px; }
    .model:hover { border-color:#405779; }
    .model input { min-height:auto; margin-top:3px; accent-color:var(--primary2); }
    .model-copy { min-width:0; }
    .model-id { display:block; word-break:break-all; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
    .model-meta { color:var(--muted); font-size:11px; }
    .custom { margin-top:12px; display:flex; gap:8px; }
    .custom input { flex:1; }
    .empty { border:1px dashed var(--line); border-radius:12px; padding:26px; text-align:center; color:var(--muted); }
    .notice { padding:11px 13px; border-radius:10px; margin:0 0 14px; display:none; }
    .notice.show { display:block; }
    .notice.error { background:#351624; border:1px solid #7f3045; color:#fecdd3; }
    .notice.success { background:#0d2e27; border:1px solid #24624f; color:#a7f3d0; }
    .pill { display:inline-flex; align-items:center; border:1px solid var(--line); border-radius:999px; color:var(--muted); padding:3px 8px; font-size:12px; }
    a { color:#93c5fd; text-decoration:none; }
    a:hover { text-decoration:underline; }
    .hidden { display:none!important; }
    @media (max-width:720px) { header { flex-direction:column; } .key-head { grid-template-columns:1fr auto; } .key-head .key-input { grid-column:1/-1; } .toolbar { align-items:flex-start; flex-direction:column; } }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div><h1>模型分配</h1><p class="subtitle">为每个入站 API Key 设置可调用模型白名单</p></div>
      <div class="header-actions"><a class="btn" href="/management.html">返回管理面板</a><button id="logout" class="btn hidden" type="button">退出</button></div>
    </header>

    <section id="login" class="panel login">
      <h2>连接管理 API</h2>
      <p>输入 CLIProxyAPI 的管理密码。密码仅保存在当前浏览器标签页中。</p>
      <label class="caption" for="secret">管理密码</label>
      <div class="row"><input id="secret" class="grow" type="password" autocomplete="current-password" placeholder="management secret"><button id="connect" class="btn primary" type="button">连接</button></div>
    </section>

    <section id="workspace" class="hidden">
      <div id="notice" class="notice"></div>
      <div class="panel toolbar">
        <div class="stats"><strong id="keyCount">0</strong> 个 API Key · <strong id="modelCount">0</strong> 个当前可用模型</div>
        <div class="row"><button id="refresh" class="btn" type="button">刷新</button><button id="addKey" class="btn" type="button">新增 Key</button><button id="save" class="btn primary" type="button">保存分配</button></div>
      </div>
      <div id="empty" class="empty hidden">还没有入站 API Key，请点击“新增 Key”。</div>
      <div id="keys" class="keys"></div>
    </section>
  </main>
  <script>
    (function () {
      "use strict";
      var state = { secret:"", items:[], models:[] };
      var byId = function (id) { return document.getElementById(id); };

      function showNotice(message, kind) {
        var node = byId("notice");
        node.textContent = message || "";
        node.className = "notice" + (message ? " show " + (kind || "error") : "");
      }

      async function api(path, options) {
        options = options || {};
        options.headers = Object.assign({ "X-Management-Key":state.secret }, options.headers || {});
        var response = await fetch(path, options);
        var contentType = response.headers.get("content-type") || "";
        var payload = contentType.indexOf("json") >= 0 ? await response.json() : await response.text();
        if (!response.ok) {
          var message = payload && (payload.message || payload.error);
          if (message && typeof message === "object") message = JSON.stringify(message);
          throw new Error(message || ("请求失败（HTTP " + response.status + "）"));
        }
        return payload;
      }

      function uniqueModels(item) {
        var map = new Map();
        state.models.forEach(function (model) { map.set(model.id, model); });
        item.models.forEach(function (id) { if (!map.has(id)) map.set(id, { id:id, unavailable:true }); });
        return Array.from(map.values()).sort(function (a,b) { return a.id.localeCompare(b.id); });
      }

      function updateCounts() {
        byId("keyCount").textContent = String(state.items.length);
        byId("modelCount").textContent = String(state.models.length);
      }

      function makeButton(label, className, handler) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = className || "btn";
        button.textContent = label;
        button.addEventListener("click", handler);
        return button;
      }

      function renderCard(item, index) {
        var card = document.createElement("article");
        card.className = "panel key-card";
        var head = document.createElement("div");
        head.className = "key-head";

        var keyInput = document.createElement("input");
        keyInput.className = "key-input";
        keyInput.type = "password";
        keyInput.value = item.key;
        keyInput.placeholder = "输入新的 API Key";
        keyInput.addEventListener("input", function () { item.key = keyInput.value; });
        head.appendChild(keyInput);

        var mode = document.createElement("select");
        mode.className = "mode";
        [["false","全部模型"],["true","仅指定模型"]].forEach(function (entry) {
          var option = document.createElement("option"); option.value = entry[0]; option.textContent = entry[1]; mode.appendChild(option);
        });
        mode.value = item.restricted ? "true" : "false";
        mode.addEventListener("change", function () { item.restricted = mode.value === "true"; render(); });
        head.appendChild(mode);

        var controls = document.createElement("div"); controls.className = "row";
        controls.appendChild(makeButton("显示", "btn small", function (event) {
          var visible = keyInput.type === "text"; keyInput.type = visible ? "password" : "text"; event.currentTarget.textContent = visible ? "显示" : "隐藏";
        }));
        controls.appendChild(makeButton("删除", "btn small danger", function () { state.items.splice(index,1); render(); }));
        head.appendChild(controls);
        card.appendChild(head);

        if (item.restricted) {
          var assignment = document.createElement("div"); assignment.className = "assignment";
          var top = document.createElement("div"); top.className = "assignment-top";
          var info = document.createElement("p"); info.textContent = "已选择 " + item.models.length + " 个模型"; top.appendChild(info);
          var batch = document.createElement("div"); batch.className = "row";
          batch.appendChild(makeButton("全选", "btn small", function () { item.models = uniqueModels(item).map(function (m) { return m.id; }); render(); }));
          batch.appendChild(makeButton("清空", "btn small", function () { item.models = []; render(); }));
          top.appendChild(batch); assignment.appendChild(top);

          var tools = document.createElement("div"); tools.className = "model-tools";
          var search = document.createElement("input"); search.className = "grow"; search.placeholder = "搜索模型"; tools.appendChild(search); assignment.appendChild(tools);
          var list = document.createElement("div"); list.className = "model-list"; assignment.appendChild(list);

          function paintModels() {
            var query = search.value.trim().toLowerCase(); list.replaceChildren();
            var models = uniqueModels(item).filter(function (m) { return !query || m.id.toLowerCase().indexOf(query) >= 0 || (m.display_name || "").toLowerCase().indexOf(query) >= 0; });
            if (!models.length) { var none = document.createElement("div"); none.className = "empty"; none.textContent = state.models.length ? "没有匹配的模型" : "当前尚无供应商模型，可在下方手动填写模型 ID"; list.appendChild(none); return; }
            models.forEach(function (model) {
              var row = document.createElement("label"); row.className = "model";
              var check = document.createElement("input"); check.type = "checkbox"; check.checked = item.models.indexOf(model.id) >= 0;
              check.addEventListener("change", function () {
                if (check.checked && item.models.indexOf(model.id) < 0) item.models.push(model.id);
                if (!check.checked) item.models = item.models.filter(function (id) { return id !== model.id; });
                info.textContent = "已选择 " + item.models.length + " 个模型";
              });
              row.appendChild(check);
              var copy = document.createElement("span"); copy.className = "model-copy";
              var id = document.createElement("span"); id.className = "model-id"; id.textContent = model.id; copy.appendChild(id);
              var metadata = [];
              if (model.display_name && model.display_name !== model.id) metadata.push(model.display_name);
              if (model.providers && model.providers.length) metadata.push(model.providers.join(", "));
              if (model.unavailable) metadata.push("当前不可用（保留分配）");
              if (metadata.length) { var meta = document.createElement("span"); meta.className = "model-meta"; meta.textContent = metadata.join(" · "); copy.appendChild(meta); }
              row.appendChild(copy); list.appendChild(row);
            });
          }
          search.addEventListener("input", paintModels); paintModels();

          var custom = document.createElement("div"); custom.className = "custom";
          var customInput = document.createElement("input"); customInput.placeholder = "手动添加模型 ID"; custom.appendChild(customInput);
          custom.appendChild(makeButton("添加", "btn", function () {
            var id = customInput.value.trim(); if (!id) return; if (item.models.indexOf(id) < 0) item.models.push(id); render();
          }));
          customInput.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); custom.querySelector("button").click(); } });
          assignment.appendChild(custom); card.appendChild(assignment);
        }
        return card;
      }

      function render() {
        updateCounts();
        var container = byId("keys"); container.replaceChildren();
        byId("empty").classList.toggle("hidden", state.items.length !== 0);
        state.items.forEach(function (item,index) { container.appendChild(renderCard(item,index)); });
      }

      async function load() {
        showNotice("");
        var data = await api("/v0/management/model-acl");
        state.items = (data.items || []).map(function (item) { return { key:item.key || "", restricted:!!item.restricted, models:(item.models || []).slice() }; });
        state.models = data.models || [];
        byId("login").classList.add("hidden"); byId("workspace").classList.remove("hidden"); byId("logout").classList.remove("hidden"); render();
      }

      async function connect() {
        state.secret = byId("secret").value.trim();
        if (!state.secret) return;
        byId("connect").disabled = true;
        try { await load(); sessionStorage.setItem("cpa-model-acl-secret",state.secret); }
        catch (error) { state.secret = ""; sessionStorage.removeItem("cpa-model-acl-secret"); alert(error.message); }
        finally { byId("connect").disabled = false; }
      }

      byId("connect").addEventListener("click",connect);
      byId("secret").addEventListener("keydown",function (event) { if (event.key === "Enter") connect(); });
      byId("refresh").addEventListener("click",function () { load().catch(function (error) { showNotice(error.message,"error"); }); });
      byId("addKey").addEventListener("click",function () { state.items.push({ key:"", restricted:false, models:[] }); render(); window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"}); });
      byId("save").addEventListener("click",async function () {
        showNotice("");
        var button = byId("save"); button.disabled = true;
        try {
          await api("/v0/management/model-acl",{ method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({items:state.items}) });
          await load(); showNotice("模型分配已保存并热更新。","success");
        } catch (error) { showNotice(error.message,"error"); }
        finally { button.disabled = false; }
      });
      byId("logout").addEventListener("click",function () { sessionStorage.removeItem("cpa-model-acl-secret"); location.reload(); });

      var remembered = sessionStorage.getItem("cpa-model-acl-secret");
      if (remembered) { state.secret = remembered; byId("secret").value = remembered; load().catch(function () { sessionStorage.removeItem("cpa-model-acl-secret"); state.secret=""; }); }
    }());
  </script>
</body>
</html>`

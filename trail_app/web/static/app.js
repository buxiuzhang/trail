/* ==========================================================
 * Trail · 编年档 — v2 (FastAPI 版)
 * 所有数据走 /api/* ，不再用 localStorage
 * ========================================================== */

const API_BASE = ""; // 同源
const TODAY = new Date().toISOString().slice(0, 10); // "2026-06-07" 形式（取本地日历）

// ====== HTTP 客户端 ======
const api = {
  async _fetch(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      let detail;
      try { detail = (await res.json()).detail; } catch { detail = res.statusText; }
      const err = new Error(detail || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  },
  get:    (p)    => api._fetch(p),
  post:   (p, b) => api._fetch(p, { method: "POST", body: JSON.stringify(b) }),
  put:    (p, b) => api._fetch(p, { method: "PUT",  body: JSON.stringify(b) }),
  del:    (p)    => api._fetch(p, { method: "DELETE" }),
};

// ====== 常量：渠道枚举 ======
const CHANNEL_KINDS = [
  { v: "group",   zh: "对接群" },
  { v: "person",  zh: "对接人" },
  { v: "email",   zh: "邮箱" },
  { v: "phone",   zh: "电话" },
  { v: "other",   zh: "其他" },
];
const CHANNEL_PLATFORMS = [
  { v: "dingtalk", zh: "钉钉" },
  { v: "wechat",   zh: "微信" },
  { v: "elink",    zh: "elink" },
  { v: "lark",     zh: "lark" },
  { v: "feishu",   zh: "飞书" },
  { v: "email",    zh: "邮箱" },
  { v: "phone",    zh: "电话" },
  { v: "other",    zh: "其他" },
];
const KIND_LABELS = Object.fromEntries(CHANNEL_KINDS.map(k => [k.v, k.zh]));
const PLATFORM_LABELS = Object.fromEntries(CHANNEL_PLATFORMS.map(p => [p.v, p.zh]));

// ====== 状态 ======
const State = {
  tasks: [],
  logs: {},                  // taskId → log[]
  overview: null,            // 顶部 today / idle
  filter: { status: "all", nature: "all", tag: "all", month: "all" },
  route: parseHash(),
  ui: { loading: true, error: null, editingLogId: null },
};

// ====== 路由 ======
function parseHash() {
  const h = location.hash || "#/";
  if (h.startsWith("#/task/")) return { name: "detail", id: Number(h.slice(7)) };
  if (h.startsWith("#/edit/")) return { name: "edit",   id: Number(h.slice(7)) };
  if (h === "#/new") return { name: "new" };
  return { name: "index" };
}
async function onRouteChange() {
  State.route = parseHash();
  // 离开详情页：清掉编辑态，避免跨页残留
  State.ui.editingLogId = null;
  // 进入详情页：拉日志（缓存里没有才拉）
  if (State.route.name === "detail" && !State.logs[State.route.id]) {
    await loadLogs(State.route.id);
  }
  render();
}
window.addEventListener("hashchange", onRouteChange);

// ====== 工具 ======
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fmtDate(d) {
  if (!d) return "—";
  return d;
}
function fmtDatePretty(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${y} · ${m} · ${day}`;
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date(TODAY);
  return Math.floor((now - d) / 86400000);
}
function monthKey(d) {
  if (!d) return "未知";
  return d.slice(0, 7);
}
function monthLabel(key) {
  if (key === "未知") return { en: "Unfiled", zh: "未归档", key, year: "—" };
  const [y, m] = key.split("-");
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  return { en: `${monthNames[+m - 1]}`, zh: `${+m} 月`, key, year: y };
}
function statusStampClass(s) {
  return {
    "未开始": "stamp--ns",
    "进行中": "stamp--ip",
    "维护中": "stamp--mt",
    "已完成": "stamp--dn",
    "已作废": "stamp--cn",
  }[s] || "stamp--ns";
}
function natureClass(n) {
  return { "长期": "lt", "临时": "tp", "维护": "mt" }[n] || "tp";
}

// ====== 业务逻辑：合法状态转移 ======
const ALLOWED = {
  "未开始": new Set(["进行中", "已作废"]),
  "进行中": new Set(["已完成", "维护中", "已作废"]),
  "已完成": new Set(["维护中", "进行中", "已作废"]),
  "维护中": new Set(["已完成", "进行中", "已作废"]),
  "已作废": new Set(),
};
function canTransition(from, to) {
  if (from === to) return true;
  return ALLOWED[from]?.has(to);
}

// ====== Catalog 编号：根据 created_at 排序顺序生成（id 永不变，编号由时间派生）======
function buildCatalogMap() {
  const sorted = [...State.tasks].sort((a, b) => {
    const ta = a.created_at || "";
    const tb = b.created_at || "";
    return ta.localeCompare(tb);
  });
  const map = new Map();
  sorted.forEach((t, i) => {
    const yr = (t.created_at || TODAY).slice(0, 4);
    map.set(t.id, `${yr} · ${String(i + 1).padStart(4, "0")}`);
  });
  return map;
}
function catalogOf(t) {
  if (!t) return "—";
  return buildCatalogMap().get(t.id) || `— · ${String(t.id).padStart(4, "0")}`;
}

// ====== 数据加载 ======
async function loadAll() {
  State.ui.loading = true;
  State.ui.error = null;
  try {
    const [tasks, overview] = await Promise.all([
      api.get("/api/tasks"),
      api.get("/api/insights/overview").catch(() => null),
    ]);
    State.tasks = tasks || [];
    State.overview = overview;
  } catch (e) {
    State.ui.error = e.message || String(e);
  } finally {
    State.ui.loading = false;
  }
  // 启动时的首次路由（不依赖 hashchange 事件）
  await onRouteChange();
}
async function loadLogs(taskId) {
  try {
    State.logs[taskId] = await api.get(`/api/tasks/${taskId}/logs`);
  } catch (e) {
    State.logs[taskId] = [];
  }
}

// ====== 渲染入口 ======
function render() {
  renderMeta();
  renderSidebar();
  renderMain();
}

function renderMeta() {
  document.getElementById("meta-today-date").textContent =
    TODAY.replace(/-/g, " · ");
  const tasks = filteredTasks();
  const idleList = tasks
    .map(t => lastLogDate(t))
    .filter(Boolean)
    .sort()
    .reverse();
  if (idleList.length) {
    const d = daysSince(idleList[0]);
    document.getElementById("meta-idle").textContent = `${d} 天`;
  } else {
    document.getElementById("meta-idle").textContent = "— 天";
  }
}

function lastLogDate(t) {
  const logs = State.logs[t.id] || [];
  if (!logs.length) return null;
  return logs[logs.length - 1].log_date;
}
function idleDays(t) {
  const last = lastLogDate(t);
  return last ? daysSince(last) : null;
}

function filteredTasks() {
  return State.tasks.filter(t => {
    if (State.filter.status !== "all" && t.status !== State.filter.status) return false;
    if (State.filter.nature !== "all" && t.nature !== State.filter.nature) return false;
    if (State.filter.tag !== "all" && !(t.tags || []).includes(State.filter.tag)) return false;
    if (State.filter.month !== "all" && monthKey(t.processing_date || t.start_date) !== State.filter.month) return false;
    return true;
  });
}

function renderSidebar() {
  // 状态
  const statusCounts = { all: State.tasks.length };
  for (const s of ["未开始","进行中","维护中","已完成","已作废"]) {
    statusCounts[s] = State.tasks.filter(t => t.status === s).length;
  }
  document.getElementById("filter-status").innerHTML = renderFilterItems([
    { k: "all", label: "全部条目" },
    { k: "进行中", label: "进行中" },
    { k: "维护中", label: "维护中" },
    { k: "未开始", label: "未开始" },
    { k: "已完成", label: "已完成" },
    { k: "已作废", label: "已作废" },
  ], statusCounts, State.filter.status, "status");

  // 性质
  const natureCounts = { all: State.tasks.length };
  for (const n of ["长期","临时","维护"]) {
    natureCounts[n] = State.tasks.filter(t => t.nature === n).length;
  }
  document.getElementById("filter-nature").innerHTML = renderFilterItems([
    { k: "all", label: "全部" },
    { k: "长期", label: "长期" },
    { k: "临时", label: "临时" },
    { k: "维护", label: "维护" },
  ], natureCounts, State.filter.nature, "nature");

  // 标签
  const tagCounts = { all: State.tasks.length };
  for (const t of State.tasks) {
    for (const tag of (t.tags || [])) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  const tagItems = Object.entries(tagCounts)
    .filter(([k]) => k !== "all")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ k: tag, label: `<span class="zh">#${escapeHtml(tag)}</span>`, count }));
  tagItems.unshift({ k: "all", label: "全部标签" });
  document.getElementById("filter-tag").innerHTML = renderFilterItems(tagItems, tagCounts, State.filter.tag, "tag");

  // 编年
  const months = {};
  for (const t of State.tasks) {
    const k = monthKey(t.processing_date || t.start_date);
    months[k] = (months[k] || 0) + 1;
  }
  const monthItems = Object.keys(months).sort().reverse().map(k => {
    const lbl = monthLabel(k);
    return { k, label: `<span class="zh">${escapeHtml(lbl.zh)}</span> <span class="en" style="font-style:italic;color:var(--ink-ghost);font-size:11.5px">${escapeHtml(lbl.en)}</span>` };
  });
  monthItems.unshift({ k: "all", label: "全部月份" });
  document.getElementById("filter-archive").innerHTML = renderFilterItems(monthItems, months, State.filter.month, "month");
}

function renderFilterItems(items, counts, active, filterKey) {
  return items.map(it => {
    const count = counts ? (counts[it.k] ?? 0) : 0;
    const isActive = active === it.k;
    return `
      <li>
        <div class="filter-item ${isActive ? "is-active" : ""}" data-filter="${filterKey}" data-value="${escapeHtml(it.k)}">
          <span class="filter-item__label">${it.label}</span>
          <span class="filter-item__count">${String(count).padStart(2, "0")}</span>
        </div>
      </li>
    `;
  }).join("");
}

document.addEventListener("click", e => {
  const item = e.target.closest(".filter-item");
  if (item) {
    State.filter[item.dataset.filter] = item.dataset.value;
    render();
  }
});

// ============================================================
// 对接渠道渲染（详情页只读 / 表单可编辑共用）
// ============================================================
function renderContactChips(contacts) {
  if (!contacts || !contacts.length) {
    return `<span class="meta-row__value" style="color:var(--ink-ghost)">— 无对接信息</span>`;
  }
  return contacts.map(c => `
    <div class="contact-chip">
      <span class="contact-chip__kind">${escapeHtml(KIND_LABELS[c.kind] || c.kind)}</span>
      <span class="contact-chip__sep">·</span>
      <span class="contact-chip__platform chip-platform--${escapeHtml(c.channel)}">${escapeHtml(PLATFORM_LABELS[c.channel] || c.channel)}</span>
      <span class="contact-chip__name">${escapeHtml(c.name)}</span>
      ${c.target ? `<span class="contact-chip__target">（${escapeHtml(c.target)}）</span>` : ""}
      ${c.note ? `<span class="contact-chip__note">／${escapeHtml(c.note)}</span>` : ""}
    </div>
  `).join("");
}

function contactSummary(contacts) {
  if (!contacts || !contacts.length) return "—";
  const persons = contacts.filter(c => c.kind === "person").length;
  const groups = contacts.filter(c => c.kind === "group").length;
  const parts = [];
  if (groups) parts.push(`${groups} 群`);
  if (persons) parts.push(`${persons} 人`);
  if (!parts.length) parts.push(`${contacts.length} 条`);
  return parts.join(" · ");
}

// ============================================================
// 表单：对接渠道行（动态行）
// ============================================================
function renderContactRows(contacts) {
  const list = contacts && contacts.length ? contacts : [{ kind: "person", channel: "wechat", name: "", target: "", note: "" }];
  return `
    <div class="contacts-block" data-block="contacts">
      ${list.map((c, i) => renderContactRow(c, i)).join("")}
      <button type="button" class="btn btn--ghost contacts-add" data-action="add-contact">＋ 添加对接渠道</button>
    </div>
  `;
}

function renderContactRow(c, i) {
  const kindOptions = CHANNEL_KINDS.map(k =>
    `<option value="${k.v}" ${c.kind === k.v ? "selected" : ""}>${escapeHtml(k.zh)}</option>`
  ).join("");
  const platformOptions = CHANNEL_PLATFORMS.map(p =>
    `<option value="${p.v}" ${c.channel === p.v ? "selected" : ""}>${escapeHtml(p.zh)}</option>`
  ).join("");
  return `
    <div class="contact-row" data-row="${i}">
      <select class="field__select" name="contacts[${i}][kind]">${kindOptions}</select>
      <select class="field__select" name="contacts[${i}][channel]">${platformOptions}</select>
      <input class="field__input" name="contacts[${i}][name]" value="${escapeHtml(c.name || "")}" placeholder="名称 *" ${c.name ? "required" : ""} />
      <input class="field__input" name="contacts[${i}][target]" value="${escapeHtml(c.target || "")}" placeholder="标识 / 号" />
      <input class="field__input" name="contacts[${i}][note]" value="${escapeHtml(c.note || "")}" placeholder="备注" />
      <button type="button" class="contact-row__del" data-action="del-contact" title="删除此行">×</button>
    </div>
  `;
}

function attachContactRowHandlers(block) {
  block.querySelectorAll('[data-action="add-contact"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const newRow = renderContactRow({ kind: "person", channel: "wechat", name: "", target: "", note: "" }, Date.now());
      const wrapper = document.createElement("div");
      wrapper.innerHTML = newRow.trim();
      btn.parentElement.insertBefore(wrapper.firstChild, btn);
      reindexContactRows(block);
    });
  });
  block.querySelectorAll('[data-action="del-contact"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".contact-row");
      // 至少留 1 行
      if (block.querySelectorAll(".contact-row").length <= 1) {
        // 清空字段，不删
        row.querySelectorAll("input").forEach(inp => inp.value = "");
        return;
      }
      row.remove();
      reindexContactRows(block);
    });
  });
}

function reindexContactRows(block) {
  block.querySelectorAll(".contact-row").forEach((row, i) => {
    row.dataset.row = i;
    row.querySelectorAll("[name^='contacts[']").forEach(el => {
      const m = el.name.match(/^contacts\[\d+\]\[(kind|channel|name|target|note)\]$/);
      if (m) el.name = `contacts[${i}][${m[1]}]`;
    });
  });
}

function collectContacts(form) {
  const block = form.querySelector('[data-block="contacts"]');
  if (!block) return [];
  const rows = block.querySelectorAll(".contact-row");
  const out = [];
  for (const r of rows) {
    const name = (r.querySelector("input[name$='[name]']").value || "").trim();
    if (!name) continue; // 空行跳过
    out.push({
      kind: r.querySelector("select[name$='[kind]']").value,
      channel: r.querySelector("select[name$='[channel]']").value,
      name,
      target: (r.querySelector("input[name$='[target]']").value || "").trim() || null,
      note: (r.querySelector("input[name$='[note]']").value || "").trim() || null,
    });
  }
  return out;
}

// ============================================================
// 渲染主区
// ============================================================
function renderMain() {
  const main = document.getElementById("main");
  if (State.ui.loading && !State.tasks.length) {
    main.innerHTML = `<div class="empty"><div class="empty__glyph">…</div><div class="empty__title">载入中</div></div>`;
    return;
  }
  if (State.ui.error) {
    main.innerHTML = `<div class="empty"><div class="empty__glyph">!</div><div class="empty__title">载入失败</div><div class="empty__sub">${escapeHtml(State.ui.error)}</div></div>`;
    return;
  }
  if (State.route.name === "detail") {
    const t = State.tasks.find(x => x.id === State.route.id);
    main.innerHTML = t ? renderDetail(t) : renderNotFound();
  } else if (State.route.name === "edit") {
    const t = State.tasks.find(x => x.id === State.route.id);
    if (!t) {
      main.innerHTML = renderNotFound();
    } else {
      main.innerHTML = renderForm("edit", t);
    }
  } else if (State.route.name === "new") {
    main.innerHTML = renderForm("new", null);
  } else {
    main.innerHTML = renderIndex();
  }
  attachMainHandlers();
}

// —— 索引页 ——
function renderIndex() {
  const tasks = filteredTasks()
    .sort((a, b) => {
      const da = a.processing_date || a.start_date || "";
      const db = b.processing_date || b.start_date || "";
      return db.localeCompare(da);
    });

  if (!tasks.length) {
    return `
      <div class="empty">
        <div class="empty__glyph">∅</div>
        <div class="empty__title">此格暂无可录之事</div>
        <div class="empty__sub">试着调整左侧筛选，或 <a href="#/new" style="color:var(--green-ink)">新建条目</a>。</div>
      </div>
    `;
  }

  const byMonth = new Map();
  for (const t of tasks) {
    const k = monthKey(t.processing_date || t.start_date);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(t);
  }

  const catMap = buildCatalogMap();
  const blocks = [];
  for (const [k, list] of byMonth) {
    const lbl = monthLabel(k);
    blocks.push(`
      <section class="month-block">
        <header class="month-header">
          <span class="month-title-zh">${escapeHtml(lbl.zh)}</span>
          <span class="month-title">${escapeHtml(lbl.en)}</span>
          <span class="month-count">${String(list.length).padStart(2, "0")} entries</span>
          <span class="month-rule"></span>
          <span class="month-count">${escapeHtml(lbl.year)}</span>
        </header>
        <div class="month-cards">
          ${list.map(t => renderTaskCard(t, catMap.get(t.id))).join("")}
        </div>
      </section>
    `);
  }

  return `
    <header class="archive-header">
      <h2 class="archive-title">
        <em>Catalogued</em> ${tasks.length === State.tasks.length ? "全部" : "筛后"} <span style="font-style:normal;color:var(--ink-ghost);font-weight:300">·</span> <span style="font-family:var(--mono);font-size:0.55em;color:var(--ink-faded);letter-spacing:0.1em;text-transform:uppercase">${String(tasks.length).padStart(2, "0")} entries</span>
      </h2>
      <span class="archive-count">Sorted · 倒序 · 最近处理在前</span>
    </header>
    ${blocks.join("")}
  `;
}

function renderTaskCard(t, catalog) {
  const logs = State.logs[t.id] || [];
  const lastDate = logs.length ? logs[logs.length - 1].log_date : null;
  const idle = idleDays(t);
  const phaseCount = {
    main: logs.filter(l => l.phase === "main").length,
    maintenance: logs.filter(l => l.phase === "maintenance").length,
  };
  const pinned = !!t.pinned_at;
  return `
    <div class="task-card ${pinned ? "task-card--pinned" : ""}" role="button" data-link="#/task/${t.id}">
      <div class="task-card__cat">
        <span class="task-card__cat-no">CAT. № <strong>${escapeHtml(catalog || String(t.id))}</strong></span>
        <span class="task-card__cat-label">${escapeHtml(t.nature)} · ${escapeHtml(t.nature === "长期" ? "long-term" : t.nature === "临时" ? "ad-hoc" : "sustaining")}</span>
        <button type="button" class="task-card__pin ${pinned ? "is-on" : ""}"
                data-action="toggle-pin" data-id="${t.id}"
                title="${pinned ? "取消置顶" : "置顶到列表首位"}">📌</button>
      </div>
      <div class="task-card__body">
        <div class="task-card__topline">
          <span class="stamp ${statusStampClass(t.status)}">${escapeHtml(t.status)}</span>
          <span class="nature-badge nature-badge--${natureClass(t.nature)}">${escapeHtml(t.nature)}</span>
        </div>
        <h3 class="task-card__title task-card__title-zh">${escapeHtml(t.title)}</h3>
        <p class="task-card__desc">${escapeHtml(t.description || "—")}</p>
        <div class="task-card__tags">
          ${(t.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>
      <dl class="task-card__margin">
        <dt>对接</dt>
        <dd>${escapeHtml(contactSummary(t.contacts))}</dd>
        <div class="margin-sep"></div>
        <dt>开始</dt>
        <dd>${fmtDatePretty(t.start_date)}</dd>
        <dt>最近记录</dt>
        <dd>${fmtDatePretty(lastDate) || "—"}</dd>
        <div class="margin-sep"></div>
        <dt>日志</dt>
        <dd>${logs.length} 条 (main ${phaseCount.main}${phaseCount.maintenance ? " / mt " + phaseCount.maintenance : ""})</dd>
        <dt>闲置</dt>
        <dd>${idle != null ? idle + " 天" : "—"}</dd>
      </dl>
    </div>
  `;
}

// —— 详情页 ——
function renderDetail(t) {
  const logs = (State.logs[t.id] || []).slice().sort((a, b) =>
    (a.log_date + a.ordinal).localeCompare(b.log_date + b.ordinal)
  );
  const lastDate = logs.length ? logs[logs.length - 1].log_date : null;
  const catalog = catalogOf(t);

  return `
    <article class="detail">
      <nav class="crumbs">
        <a href="#/">编年档</a>
        <span class="crumbs__sep">›</span>
        <span>CAT. № ${escapeHtml(catalog)}</span>
      </nav>

      <header class="detail__hd">
        <div class="detail__cat-row">
          <span class="cat-no">CAT. № ${escapeHtml(catalog)}</span>
          <span class="cat-rule"></span>
          <span>Filed under <strong style="color:var(--ink)">${escapeHtml(t.nature)}</strong></span>
        </div>
        <h1 class="detail__title detail__title-zh">${escapeHtml(t.title)}</h1>
        ${t.alias ? `<p class="detail__alias">ALIAS · <em>${escapeHtml(t.alias)}</em></p>` : ""}
        <p class="detail__lede">${escapeHtml(t.description || "")}</p>
        <div class="detail__badges">
          <span class="stamp stamp--big ${statusStampClass(t.status)}">${escapeHtml(t.status)}</span>
          <span class="nature-badge nature-badge--${natureClass(t.nature)}">${escapeHtml(t.nature)}</span>
          <span class="tag">${logs.length} 条日志</span>
          ${(t.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </header>

      <div class="detail__body">
        <aside class="meta-pane">
          <h3 class="meta-pane__title">编目信息</h3>
          <div class="meta-row meta-row--contacts">
            <span class="meta-row__label">对接渠道</span>
            <div class="meta-row__value meta-row__value--contacts">
              ${renderContactChips(t.contacts)}
            </div>
          </div>
          ${metaRow("任务开始", t.start_date, true)}
          ${metaRow("开始处理", t.processing_date, true)}
          ${metaRow("完成时间", t.end_date, true)}
          ${metaRow("最近记录", lastDate, true)}
          ${metaRow("状态", t.status)}

          ${t.summary ? `
            <div class="summary-box">
              <span class="summary-box__label">主体总结</span>
              ${escapeHtml(t.summary)}
            </div>
          ` : ""}
          ${t.maintenance_summary ? `
            <div class="summary-box summary-box--mt">
              <span class="summary-box__label">维护期总结</span>
              ${escapeHtml(t.maintenance_summary)}
            </div>
          ` : ""}

          <div class="meta-actions">
            <a class="btn" href="#/edit/${t.id}" data-link="#/edit/${t.id}" style="text-decoration:none">✎ 编辑条目</a>
            ${(t.status !== "已完成" && t.status !== "已作废") ? `<button class="btn" data-action="add-log">＋ 记录今日</button>` : ""}
            ${(t.status === "进行中" || t.status === "维护中") ? `<button class="btn btn--ghost" data-action="change-status" data-id="${t.id}">变更状态</button>` : ""}
            ${t.status !== "已作废" ? `<button class="btn btn--danger" data-action="cancel" data-id="${t.id}">作废此条</button>` : ""}
          </div>
        </aside>

        <section class="logbook">
          <header class="logbook__head">
            <h2 class="logbook__title logbook__title-zh">编年日志</h2>
            <span class="logbook__count">${logs.length} entries · 可改可软删</span>
          </header>

          ${(t.status !== "已完成" && t.status !== "已作废") ? renderCompose(t) : `<div class="empty-log"><span class="empty-log__glyph">✕</span>此任务已封版，不再接受新日志。</div>`}

          <div class="log-entries">
            ${logs.length === 0
              ? `<div class="empty-log"><span class="empty-log__glyph">∅</span>尚无记录。写下第一笔吧。</div>`
              : logs.map(l => renderLogEntry(t, l)).join("")}
          </div>
        </section>
      </div>
    </article>
  `;
}

function metaRow(label, value, mono = false) {
  return `
    <div class="meta-row">
      <span class="meta-row__label">${escapeHtml(label)}</span>
      <span class="meta-row__value ${mono ? "meta-row__value--mono" : ""}">${escapeHtml(value || "—")}</span>
    </div>
  `;
}

function renderLogEntry(t, l) {
  const isMt = l.phase === "maintenance";
  const isEditing = State.ui.editingLogId === l.id;
  // 编辑态：本条 entry 整块换成 compose form
  if (isEditing) {
    return `<div class="log-entry log-entry--editing log-entry--mt">${renderCompose(t, l)}</div>`;
  }
  const editedTag = l.updated_at
    ? `<span class="log-entry__edited" title="${escapeHtml(l.updated_at)}">已改 ${l.edit_count} 次</span>`
    : "";
  return `
    <div class="log-entry ${isMt ? "log-entry--mt" : ""}">
      <div class="log-entry__date">
        <span class="log-entry__date-day">${l.log_date.slice(8, 10)}</span>
        <span>${l.log_date.slice(5, 7)}/${l.log_date.slice(2, 4)}</span>
        <span class="log-entry__date-yr">${l.log_date.slice(0, 4)}</span>
      </div>
      <span class="log-entry__dot" aria-hidden="true"></span>
      <div class="log-entry__body">
        <div class="log-entry__topline">
          <span class="log-entry__phase">${isMt ? "maintenance" : "main"}</span>
          <span class="log-entry__ord">№ ${String(l.id).padStart(3, "0")}</span>
          ${editedTag}
        </div>
        <p class="log-entry__content">${escapeHtml(l.content)}</p>
        ${l.polished_content ? `
          <div class="log-entry__polish">
            <span class="log-entry__polish-label">润色后</span>
            ${escapeHtml(l.polished_content)}
          </div>
        ` : ""}
        <div class="log-entry__actions">
          <button data-action="edit-log" data-id="${t.id}" data-log="${l.id}">编辑</button>
          <button data-action="soft-delete-log" data-id="${t.id}" data-log="${l.id}">软删</button>
        </div>
      </div>
    </div>
  `;
}

function renderCompose(t, editing = null) {
  // 已完成 / 已作废 → 封版，不渲染日志表单
  if (t.status === "已完成" || t.status === "已作废") return "";
  // editing = null → 新增；editing = log 对象 → 编辑模式
  const isEdit = !!editing;
  const initialDate = isEdit ? editing.log_date : TODAY;
  const initialPhase = isEdit ? editing.phase : (t.status === "维护中" ? "maintenance" : "main");
  const initialContent = isEdit ? escapeHtml(editing.content) : "";
  return `
    <form class="logbook__compose" data-action="${isEdit ? 'edit-log-form' : 'add-log-form'}"
          data-id="${t.id}" ${isEdit ? `data-log="${editing.id}"` : ""}>
      <div class="logbook__compose-row">
        <label>日期</label>
        <input type="date" name="log_date" value="${initialDate}" required />
        <label>阶段</label>
        <select name="phase">
          <option value="main"        ${initialPhase === "main" ? "selected" : ""}>main · 主体</option>
          <option value="maintenance" ${initialPhase === "maintenance" ? "selected" : ""}>maintenance · 维护</option>
        </select>
      </div>
      <textarea name="content" placeholder="今日所记……" required>${initialContent}</textarea>
      <div class="logbook__compose-foot">
        <span>${isEdit ? `编辑中 · № ${String(editing.id).padStart(3, "0")}` : "可改 · 可软删"}</span>
        <div style="display:flex;gap:10px;align-items:center">
          ${isEdit ? `<button type="button" class="btn btn--ghost" data-action="cancel-edit">取消</button>` : ""}
          <button type="button" data-action="polish-compose" class="btn btn--ghost">✦ 请求润色</button>
          <button type="submit" class="btn btn--primary" style="padding:6px 16px;font-size:10.5px">${isEdit ? "保存修改" : "＋ 落档"}</button>
        </div>
      </div>
    </form>
  `;
}

// ============================================================
// 表单：新建 / 编辑 通用
// ============================================================
function renderForm(mode, task) {
  const isEdit = mode === "edit";
  const t = task || {};
  // start_date 默认今天（编辑模式：有值用现有，空用今天）
  const startDateDefault = t.start_date || TODAY;
  // tags 拼回字符串
  const tagsStr = (t.tags || []).join(", ");
  const contacts = t.contacts || [];

  return `
    <article class="form-page">
      <nav class="crumbs">
        <a href="${isEdit ? `#/task/${t.id}` : "#/"}">${isEdit ? "返回详情" : "编年档"}</a>
        <span class="crumbs__sep">›</span>
        <span>${isEdit ? "编辑条目" : "新建条目"}</span>
      </nav>
      <form class="form-card" id="form-task" data-mode="${mode}" data-id="${t.id || ""}">
        <header class="form-card__hd">
          <h1 class="form-card__title form-card__title-zh">${isEdit ? "编辑条目" : "新建条目"}</h1>
          <span class="form-card__no">${isEdit ? `№ ${escapeHtml(String(t.id))}` : "№ 待定"}</span>
        </header>
        <div class="field">
          <div class="field__label">
            <span>任务标题</span><span class="field__hint">required</span>
          </div>
          <input class="field__input" name="title" required value="${escapeHtml(t.title || "")}" placeholder="例：TDengine 时序数据库整库告警监控" />
        </div>
        <div class="field-row">
          <div class="field">
            <div class="field__label"><span>任务别名</span><span class="field__hint">口头沟通用</span></div>
            <input class="field__input" name="alias" value="${escapeHtml(t.alias || "")}" placeholder="例：TDengine告警" />
          </div>
          <div class="field">
            <div class="field__label"><span>任务开始</span><span class="field__hint">默认今天</span></div>
            <input class="field__input" name="start_date" type="date" value="${escapeHtml(startDateDefault)}" />
          </div>
          <div class="field">
            <div class="field__label"><span>开始处理</span></div>
            <input class="field__input" name="processing_date" type="date" value="${escapeHtml(t.processing_date || "")}" />
          </div>
        </div>
        <div class="field">
          <div class="field__label"><span>任务描述</span></div>
          <textarea class="field__textarea" name="description" placeholder="把要做什么写清楚。先粗糙后润色。">${escapeHtml(t.description || "")}</textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <div class="field__label"><span>状态</span></div>
            ${isEdit ? `
              <div style="display:flex; align-items:center; gap:12px; padding-top:4px;">
                <span class="stamp ${statusStampClass(t.status)}">${escapeHtml(t.status)}</span>
                ${(t.status === "进行中" || t.status === "维护中") ? `<button type="button" class="btn btn--ghost" data-action="change-status" data-id="${t.id}" style="font-size:10px;padding:5px 10px;">变更状态</button>` : ""}
              </div>
            ` : `
              <div style="display:flex; align-items:center; gap:12px; padding-top:4px;">
                <span class="stamp stamp--ns">未开始</span>
                <span style="font-family:var(--body);font-size:12px;color:var(--ink-ghost);font-style:italic;">添加日志后自动转入进行中</span>
              </div>
            `}
          </div>
          ${(isEdit && t.status === "已完成") || (!isEdit)
            ? ""
            : `<div class="field" data-when-status="已完成">
                <div class="field__label">
                  <span>完成时间</span>
                  <span class="field__hint">可手动覆盖</span>
                </div>
                <input class="field__input" name="end_date" type="date" value="${escapeHtml(t.end_date || "")}" />
              </div>`
          }
        </div>
        <div class="field">
          <div class="field__label">
            <span>对接渠道</span>
            <span class="field__hint">可多行 · 钉钉/微信/elink/邮箱/电话</span>
          </div>
          ${renderContactRows(contacts)}
        </div>
        <div class="field-row">
          <div class="field">
            <div class="field__label"><span>性质</span></div>
            <select class="field__select" name="nature">
              <option value="长期" ${t.nature === "长期" ? "selected" : ""}>长期</option>
              <option value="临时" ${(!t.nature || t.nature === "临时") ? "selected" : ""}>临时</option>
              <option value="维护" ${t.nature === "维护" ? "selected" : ""}>维护</option>
            </select>
          </div>
          <div class="field">
            <div class="field__label"><span>标签（逗号 / 顿号 / 空格分隔）</span></div>
            <input class="field__input" name="tags" value="${escapeHtml(tagsStr)}" placeholder="监控, 钉钉, 时序" />
          </div>
        </div>
        <div class="form-foot">
          <span class="form-foot__sig">— ${isEdit ? "改即存档" : "入档即正典"} —</span>
          <div style="display:flex;gap:10px">
            <a href="${isEdit ? `#/task/${t.id}` : "#/"}" class="btn btn--ghost" style="text-decoration:none">取消</a>
            <button type="submit" class="btn btn--primary">${isEdit ? "保 存" : "落 档"}</button>
          </div>
        </div>
      </form>
    </article>
  `;
}

// 兼容旧名
function renderNew() { return renderForm("new", null); }

function renderNotFound() {
  return `
    <div class="empty">
      <div class="empty__glyph">404</div>
      <div class="empty__title">此格未录</div>
      <div class="empty__sub">返回 <a href="#/" style="color:var(--green-ink)">编年档</a></div>
    </div>
  `;
}

// ============================================================
// 主区事件
// ============================================================
// ============================================================
// 日志：提交 / 软删 / 落档前润色
// ============================================================
async function submitLogForm(form, mode) {
  const fd = new FormData(form);
  const taskId = form.dataset.id;
  const logId = form.dataset.log;
  const payload = {
    log_date: fd.get("log_date"),
    content: (fd.get("content") || "").trim(),
    phase: fd.get("phase"),
  };
  try {
    if (mode === "edit") {
      await api.put(`/api/tasks/${taskId}/logs/${logId}`, payload);
    } else {
      await api.post(`/api/tasks/${taskId}/logs`, payload);
      // 新增时同步 processing_date（仅首次）
      const task = State.tasks.find(t => t.id === Number(taskId));
      if (task && !task.processing_date) {
        await api.put(`/api/tasks/${taskId}`, { processing_date: payload.log_date });
      }
    }
    await loadLogs(taskId);
    await refreshTasks();
    State.ui.editingLogId = null;
    form.reset();
    render();
  } catch (err) {
    showToast((mode === "edit" ? "保存失败：" : "落档失败：") + err.message);
  }
}

async function softDeleteLog(taskId, logId) {
  if (!confirm("软删这条日志？之后可在管理界面恢复（M3）。")) return;
  try {
    await api.del(`/api/tasks/${taskId}/logs/${logId}`);
    await loadLogs(taskId);
    render();
    showToast("已软删");
  } catch (err) {
    showToast("删除失败：" + err.message);
  }
}

async function polishCompose(btn) {
  const form = btn.closest("form");
  if (!form) return;
  const ta = form.querySelector('textarea[name="content"]');
  // 单按钮 mode 切换：润色 ↔ 撤销
  if (btn.dataset.mode === "undo") {
    ta.value = form.dataset.polishOriginal || "";
    delete form.dataset.polishOriginal;
    btn.textContent = "✦ 请求润色";
    btn.dataset.mode = "";
    return;
  }
  const raw = (ta.value || "").trim();
  if (!raw) { showToast("先写点内容再润色"); return; }
  btn.disabled = true;
  const origLabel = btn.textContent;
  btn.textContent = "润色中…";
  try {
    const out = await api.post("/api/llm/polish", { content: raw, task_id: Number(form.dataset.id) });
    form.dataset.polishOriginal = raw;
    ta.value = out.polished;
    // 真实 LLM：out.mock 永远是 false；保留 "↺ 撤销润色" 即可，不再带 "(模拟)" 后缀
    btn.textContent = "↺ 撤销润色";
    btn.dataset.mode = "undo";
  } catch (err) {
    const hint = err.status === 503
      ? "（未配置 LLM，请设置 ANTHROPIC_API_KEY）"
      : err.status === 502
        ? "（LLM 调用失败，检查网络/余额）"
        : "";
    showToast("润色失败：" + err.message + (hint ? " " + hint : ""));
    btn.textContent = origLabel;
  } finally {
    btn.disabled = false;
  }
}


function attachMainHandlers() {
  const main = document.getElementById("main");
  main.querySelectorAll("[data-link]").forEach(el => {
    el.addEventListener("click", e => {
      e.preventDefault();
      location.hash = el.dataset.link;
    });
  });
  main.querySelectorAll('[data-action="change-status"]').forEach(btn => {
    btn.addEventListener("click", () => openStatusModal(btn.dataset.id));
  });
  main.querySelectorAll('[data-action="cancel"]').forEach(btn => {
    btn.addEventListener("click", () => openCancelModal(btn.dataset.id));
  });
  main.querySelectorAll('form[data-action="add-log-form"]').forEach(form => {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      await submitLogForm(form, "new");
    });
  });
  main.querySelectorAll('form[data-action="edit-log-form"]').forEach(form => {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      await submitLogForm(form, "edit");
    });
  });
  main.querySelectorAll('[data-action="add-log"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const ta = main.querySelector(".logbook__compose textarea");
      if (ta) ta.focus();
    });
  });
  main.querySelectorAll('[data-action="edit-log"]').forEach(btn => {
    btn.addEventListener("click", () => {
      State.ui.editingLogId = Number(btn.dataset.log);
      render();
    });
  });
  main.querySelectorAll('[data-action="cancel-edit"]').forEach(btn => {
    btn.addEventListener("click", () => {
      State.ui.editingLogId = null;
      render();
    });
  });
  main.querySelectorAll('[data-action="soft-delete-log"]').forEach(btn => {
    btn.addEventListener("click", () => softDeleteLog(btn.dataset.id, btn.dataset.log));
  });
  main.querySelectorAll('[data-action="polish-compose"]').forEach(btn => {
    btn.addEventListener("click", () => polishCompose(btn));
  });
  main.querySelectorAll('[data-action="toggle-pin"]').forEach(btn => {
    btn.addEventListener("click", async e => {
      // 阻止冒泡到外层 task-card 的 data-link 跳转
      e.stopPropagation();
      e.preventDefault();
      const id = btn.dataset.id;
      const card = btn.closest(".task-card");
      const wasPinned = card?.classList.contains("task-card--pinned");
      try {
        if (wasPinned) {
          await api.post(`/api/tasks/${id}/unpin`);
        } else {
          await api.post(`/api/tasks/${id}/pin`);
        }
        await refreshTasks();
        showToast(wasPinned ? "已取消置顶" : "已置顶");
      } catch (err) {
        showToast("操作失败：" + err.message);
      }
    });
  });

  // 任务表单（新建 / 编辑）
  const formTask = document.getElementById("form-task");
  if (formTask) {
    // 联系人动态行
    const contactsBlock = formTask.querySelector('[data-block="contacts"]');
    if (contactsBlock) attachContactRowHandlers(contactsBlock);

    // 状态切换 → 显隐完成时间
    const statusSelect = formTask.querySelector('select[name="status"]');
    const endDateField = formTask.querySelector('[data-when-status="已完成"]');
    function syncEndDateVisibility() {
      if (!statusSelect || !endDateField) return;
      endDateField.style.display = statusSelect.value === "已完成" ? "" : "none";
    }
    if (statusSelect) {
      syncEndDateVisibility();
      statusSelect.addEventListener("change", syncEndDateVisibility);
    }

    formTask.addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(formTask);
      const title = (fd.get("title") || "").trim();
      if (!title) return;
      const tags = (fd.get("tags") || "").split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
      const contacts = collectContacts(formTask);
      const mode = formTask.dataset.mode;
      const taskId = formTask.dataset.id;
      const payload = {
        title,
        alias: (fd.get("alias") || "").trim() || null,
        description: (fd.get("description") || "").trim() || null,
        start_date: fd.get("start_date") || null,
        processing_date: fd.get("processing_date") || null,
        end_date: fd.get("end_date") || null,
        nature: fd.get("nature"),
        tags,
        contacts,
      };
      // 状态变更统一走专用按钮+状态机（openStatusModal / cancelTask），表单不再传 status
      try {
        if (mode === "edit" && taskId) {
          await api.put(`/api/tasks/${taskId}`, payload);
          await refreshTasks();
          showToast("已保存");
          location.hash = `#/task/${taskId}`;
        } else {
          const created = await api.post("/api/tasks", payload);
          await refreshTasks();
          location.hash = `#/task/${created.id}`;
        }
      } catch (err) {
        if (err.status === 409) {
          showToast("标题重复，任务已存在");
        } else {
          showToast((mode === "edit" ? "保存失败：" : "创建失败：") + err.message);
        }
      }
    });
  }
}

async function refreshTasks() {
  State.tasks = await api.get("/api/tasks");
}

document.getElementById("btn-new").addEventListener("click", () => {
  location.hash = "#/new";
});

// ============================================================
// 模态：状态变更
// ============================================================
function openStatusModal(id) {
  const t = State.tasks.find(x => x.id == id);
  if (!t) return;
  const transitions = ["进行中","维护中","已完成","已作废","未开始"]
    .filter(s => s !== t.status && canTransition(t.status, s));

  if (t.status === "进行中" && transitions.includes("已完成")) {
    showModal({
      eyebrow: "完成询问",
      title: "此条是否含维护？",
      titleMode: "zh",
      bodyHtml: `
        <p>任务 <em>${escapeHtml(t.title)}</em> 即将标记为完成。</p>
        <p>完成后偶有零星调整是常有的事。请选择：</p>
        <div class="ask-stamp-row">
          <span class="stamp stamp--dn">已完成 · 不再维护</span>
          <span class="stamp stamp--mt">维护中 · 仍要照看</span>
        </div>
        <p>含维护的状态会在此条上以 <em style="color:var(--green)">维护期</em> 显示，主体总结与维护总结分开记录。</p>
      `,
      buttons: [
        { label: "已完成 · 不再维护", class: "btn--primary", action: async () => { await updateStatus(id, "已完成"); } },
        { label: "维护中 · 仍要照看", class: "btn--ghost",   action: async () => { await updateStatus(id, "维护中"); } },
      ],
    });
    return;
  }

  if (t.status === "维护中") {
    showModal({
      eyebrow: "封版询问",
      title: "将此任务标记为已完成？",
      titleMode: "zh",
      bodyHtml: `
        <p>任务 <em>${escapeHtml(t.title)}</em> 当前为 <span class="stamp stamp--mt">维护中</span>。</p>
        <p>标记为已完成后将<em style="color:var(--oxblood)">封版</em>，不能再添加日志。</p>
      `,
      buttons: [
        { label: "取消", class: "btn--ghost", action: closeModal },
        { label: "已完成 · 封版", class: "btn--primary", action: async () => { await updateStatus(id, "已完成"); } },
      ],
    });
    return;
  }

  if (transitions.length === 0) {
    showModal({
      eyebrow: "状态变更",
      title: "无可用变更",
      titleMode: "zh",
      bodyHtml: `<p>当前状态 <em>${escapeHtml(t.status)}</em> 为终态，无法变更。</p>`,
      buttons: [{ label: "知道了", class: "btn--primary", action: closeModal }],
    });
    return;
  }

  showModal({
    eyebrow: "状态变更",
    title: "请选择新状态",
    titleMode: "zh",
    bodyHtml: `
      <p>当前 <em>${escapeHtml(t.title)}</em> 的状态是 <span class="stamp ${statusStampClass(t.status)}">${escapeHtml(t.status)}</span></p>
      <p>合法转移至：</p>
      <ul>
        ${transitions.map(s => `<li>转移为 <span class="stamp ${statusStampClass(s)}">${escapeHtml(s)}</span></li>`).join("")}
      </ul>
    `,
    buttons: transitions.map(s => ({
      label: `→ ${s}`,
      class: "btn--ghost",
      action: () => updateStatus(id, s),
    })),
  });
}

function openCancelModal(id) {
  const t = State.tasks.find(x => x.id == id);
  if (!t) return;
  showModal({
    eyebrow: "作废询问",
    title: "确认作废？",
    titleMode: "zh",
    bodyHtml: `
      <p>将 <em>${escapeHtml(t.title)}</em> 标记为 <span class="stamp stamp--cn">已作废</span>。</p>
      <p class="quote">作废后此条不再参与进行中统计，但所有日志保留，可作为日后回溯之用。</p>
    `,
    buttons: [
      { label: "取消", class: "btn--ghost", action: closeModal },
      { label: "确认作废", class: "btn--danger", action: async () => { await cancelTask(id); } },
    ],
  });
}

async function updateStatus(id, newStatus) {
  try {
    await api.post(`/api/tasks/${id}/status`, { new_status: newStatus });
    await refreshTasks();
    if (State.route.name === "detail") await loadLogs(State.route.id);
    closeModal();
    render();
  } catch (err) {
    showToast("状态变更失败：" + err.message);
  }
}

async function cancelTask(id) {
  try {
    await api.post(`/api/tasks/${id}/cancel`);
    await refreshTasks();
    closeModal();
    render();
  } catch (err) {
    showToast("作废失败：" + err.message);
  }
}

// ============================================================
// 模态工具
// ============================================================
function showModal({ eyebrow, title, titleMode, bodyHtml, buttons }) {
  const modal = document.getElementById("modal");
  document.getElementById("modal-eyebrow").textContent = eyebrow;
  const tEl = document.getElementById("modal-title");
  tEl.className = "modal__title" + (titleMode === "zh" ? " modal__title-zh" : "");
  tEl.textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  const foot = document.getElementById("modal-foot");
  foot.innerHTML = "";
  for (const b of buttons) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `btn ${b.class || ""}`;
    el.textContent = b.label;
    el.addEventListener("click", b.action);
    foot.appendChild(el);
  }
  modal.hidden = false;
}
function closeModal() {
  document.getElementById("modal").hidden = true;
}
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal").addEventListener("click", e => {
  if (e.target.id === "modal") closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

// 简单 toast（M3 时再换正经 toast）
let _toastTimer = null;
function showToast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText = `
      position:fixed;left:50%;bottom:32px;transform:translateX(-50%);
      background:var(--ink);color:var(--paper);padding:10px 18px;
      font-family:var(--mono);font-size:12px;letter-spacing:0.06em;
      box-shadow:0 12px 32px -8px rgba(20,12,5,0.4);
      z-index:600;opacity:0;transition:opacity 200ms ease;
    `;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2400);
}

// ============================================================
// 启动
// ============================================================
loadAll();

function ensureStoreCompat() {
  if (typeof getRecordType !== "function") {
    window.getRecordType = function (record) {
      if (record?.recordType) return record.recordType;
      return record?.source === "po-upload" ? "order" : "quote";
    };
  }
  if (typeof getQuotes !== "function") {
    window.getQuotes = function (data, channelId) {
      const list = channelId
        ? data.proposals.filter((p) => p.channelId === channelId)
        : data.proposals;
      return list.filter((p) => getRecordType(p) === "quote");
    };
  }
  if (typeof getOrders !== "function") {
    window.getOrders = function (data, channelId) {
      const list = channelId
        ? data.proposals.filter((p) => p.channelId === channelId)
        : data.proposals;
      return list.filter((p) => getRecordType(p) === "order");
    };
  }
  if (typeof getClientProposalCount !== "function") {
    window.getClientProposalCount = function (data, client) {
      return getQuotes(data).filter((p) => orderMatchesClient(p, client)).length;
    };
  }
  if (typeof getClientOrderCount !== "function") {
    window.getClientOrderCount = function (data, client) {
      return getOrders(data).filter((p) => orderMatchesClient(p, client)).length;
    };
  }
  if (typeof updateChannel !== "function") {
    window.updateChannel = function (data, channelId, updates) {
      const channels = getChannels(data);
      const idx = channels.findIndex((c) => c.id === channelId);
      if (idx === -1) return { ok: false, error: "판매국가를 찾을 수 없습니다." };
      const name = updates.name?.trim();
      if (!name) return { ok: false, error: "판매국가명을 입력해주세요." };
      const currency = updates.currency === "KRW" ? "KRW" : "USD";
      const fobPercent = parseFloat(updates.defaultFobRate);
      channels[idx] = {
        ...channels[idx],
        name,
        currency,
        currencySymbol: currency === "KRW" ? "₩" : "$",
        defaultFobRate: isNaN(fobPercent) ? channels[idx].defaultFobRate : fobPercent / 100,
      };
      data.channels = channels;
      saveData(data);
      return { ok: true };
    };
  }
  if (typeof updateClient !== "function") {
    window.updateClient = function (data, clientId, updates) {
      const client = (data.clients || []).find((c) => c.id === clientId);
      if (!client) return { ok: false, error: "업체를 찾을 수 없습니다." };
      const name = updates.name?.trim();
      if (!name) return { ok: false, error: "업체명을 입력해주세요." };
      client.name = name;
      client.contact = updates.contact?.trim() || "";
      client.memo = updates.memo?.trim() || "";
      saveData(data);
      return { ok: true };
    };
  }
  if (typeof saveOrder !== "function") {
    window.saveOrder = function (data, order) {
      const buyerName = String(order.buyerName || order.clientName || "").trim();
      const version = saveProposal(data, {
        ...order,
        recordType: "order",
        buyerName,
        salesClientName: buyerName,
        clientName: buyerName,
      });
      return { version, record: data.proposals[0] };
    };
  }
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

ensureStoreCompat();

let appData = loadData();
let currentView = "dashboard";
let historyFilter = "";
let clientFilter = "";
let salesMonth = new Date().toISOString().slice(0, 7);
let salesChannelId = "";
let termsChannelId = "CN";
let masterChannelId = "CN";
let masterNewChannel = false;
let masterEditClientId = null;
let proposalState = {
  channelId: "CN",
  clientId: "",
  clientName: "",
  poDate: new Date().toISOString().slice(0, 10),
  fobRate: 29,
  exchangeRate: DEFAULT_EXCHANGE_RATE,
  items: {},
};

let productEditCode = null;

function freshPoUploadState() {
  return {
    channelId: "CN",
    clientId: "",
    clientName: "",
    poDate: new Date().toISOString().slice(0, 10),
    poNumber: "",
    fileName: "",
    fileKind: "",
    mode: "file",
    rows: [],
    manualSelected: [],
    manualItems: {},
    manualPriceCurrency: "USD",
    detectedCurrency: null,
    status: "idle",
    statusMsg: "",
    warning: "",
  };
}

let poUploadState = freshPoUploadState();

function getChannelList() {
  return getChannels(appData);
}

function findChannel(channelId) {
  return getChannelList().find((c) => c.id === channelId) || getChannelList()[0];
}

function initProposalState(channelId) {
  const channel = findChannel(channelId);
  proposalState.channelId = channel.id;
  proposalState.fobRate = Math.round(channel.defaultFobRate * 100);
  proposalState.exchangeRate = appData.exchangeRate || DEFAULT_EXCHANGE_RATE;
  proposalState.items = {};
  getProducts(appData).forEach((p) => {
    proposalState.items[p.code] = {
      srpKrw: p.srpKrw ?? null,
      srpUsd: p.srpUsd ?? null,
      poQty: 0,
    };
  });
}

function parseOptionalNumber(value) {
  if (value === "" || value == null) return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function calcFobFromSrp(srpKrw, srpUsd, fobRatePercent, exchangeRate) {
  const rate = fobRatePercent / 100;
  const hasUsd = srpUsd != null && srpUsd > 0;
  const hasKrw = srpKrw != null && srpKrw > 0;

  if (!hasUsd && !hasKrw) {
    return { fobUsd: null, fobKrw: null, hasSrp: false };
  }

  let fobUsd, fobKrw;
  if (hasUsd) {
    fobUsd = srpUsd * rate;
    fobKrw = fobUsd * exchangeRate;
  } else {
    fobKrw = srpKrw * rate;
    fobUsd = fobKrw / exchangeRate;
  }
  return { fobUsd, fobKrw, hasSrp: true };
}

function calcCtn(poQty, cartonQty) {
  return cartonQty > 0 ? poQty / cartonQty : 0;
}

function calcCbmQty(ctn, cbm) {
  return ctn * cbm;
}

function calcAmount(fobUsd, fobKrw, poQty, channel) {
  if (channel.currency === "KRW") {
    return (fobKrw ?? 0) * poQty;
  }
  return (fobUsd ?? 0) * poQty;
}

function formatKrw(value) {
  if (value == null) return "—";
  return "₩" + Math.round(value).toLocaleString("ko-KR");
}

function formatJpy(value) {
  if (value == null) return "—";
  return "¥" + Math.round(value).toLocaleString("ja-JP");
}

function formatUsd(value) {
  if (value == null) return "—";
  return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoney(value, channel) {
  if (value == null) return "—";
  if (channel.currency === "KRW") return formatKrw(value);
  return formatUsd(value);
}

function formatByCurrency(value, currency) {
  if (value == null) return "—";
  if (currency === "KRW") return formatKrw(value);
  if (currency === "JPY") return formatJpy(value);
  return formatUsd(value);
}

function formatProposalMoney(value, proposal, channel) {
  return formatByCurrency(value, getProposalCurrency(proposal, channel));
}

function formatDualCurrencyTotals(krw, usd, separator = " · ", jpy = 0) {
  const parts = [];
  if (usd > 0) parts.push(formatUsd(usd));
  if (krw > 0) parts.push(formatKrw(krw));
  if (jpy > 0) parts.push(formatJpy(jpy));
  return parts.length ? parts.join(separator) : "—";
}

function formatDualCurrencyTotalsHtml(krw, usd, jpy = 0) {
  return formatDualCurrencyTotals(krw, usd, "<br>", jpy);
}

function formatProposalUnitPrice(item, proposal, channel) {
  const currency = getProposalCurrency(proposal, channel);
  if (currency === "KRW") return formatKrw(item.srpKrw ?? 0);
  if (currency === "JPY") return formatJpy(item.srpJpy ?? 0);
  return formatUsd(item.srpUsd ?? 0);
}

function renderSalesChannelDetail(channelId, summary, monthLabel) {
  const ch = summary.byChannel.find((c) => c.channelId === channelId);
  if (!ch || ch.count === 0) return "";

  const channelClients = summary.clients
    .filter((c) => c.channelId === channelId)
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));

  return `
    <div class="card sales-channel-detail">
      <div class="card-title">${ch.channelName} 발주 상세 — ${monthLabel} (${ch.count}건)</div>
      <div class="card-desc">
        국가 합계 ${formatDualCurrencyTotals(ch.totalKrw, ch.totalUsd, " · ", ch.totalJpy)} · 업체 ${channelClients.length}곳
        ${ch.isOrphan ? `<br><span class="field-hint">예전에 등록한 판매국가 코드의 발주입니다. 업체명을 수정해 현재 국가·업체에 맞게 정리할 수 있습니다.</span>` : ""}
      </div>
      ${channelClients
        .map((client) => {
          const proposals = client.proposals
            .slice()
            .sort((a, b) => (b.poDate || "").localeCompare(a.poDate || "") || b.version - a.version);
          return `
        <div class="sales-client-block">
          <div class="sales-client-header">
            <div>
              <strong>${escapeAttr(client.clientName)}</strong>
              <span class="sales-client-count">${client.count}건</span>
            </div>
            <div class="sales-client-totals">${formatDualCurrencyTotalsHtml(client.totalKrw, client.totalUsd, client.totalJpy)}</div>
          </div>
          ${proposals
            .map(
              (p) => `
            <div class="history-item">
              <div class="history-meta">
                <span class="badge badge-default">발주</span>
                <span class="version">v${p.version}</span>
                <span class="date">${p.poDate}</span>
                ${p.poNumber ? `<span>발주번호 ${escapeAttr(p.poNumber)}</span>` : ""}
                <span class="date">${formatProposalMoney(p.totalAmount, p, ch)}</span>
              </div>
              <div class="history-actions no-print">
                <button class="btn btn-secondary btn-sm" data-view-proposal="${p.id}">보기</button>
                <button class="btn btn-danger btn-sm" data-delete-proposal="${p.id}">삭제</button>
              </div>
            </div>`
            )
            .join("")}
        </div>`;
        })
        .join("")}
    </div>
    <div id="sales-proposal-detail"></div>
  `;
}

function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function channelBadge(channelId) {
  if (channelId === "__orphan__") {
    return `<span class="badge badge-default">이전</span>`;
  }
  const ch = getChannelList().find((c) => c.id === channelId);
  const badgeClass = {
    "KR-OLIVE": "badge-olive",
    CN: "badge-cn",
    US: "badge-us",
  }[channelId] || "badge-default";
  return `<span class="badge ${badgeClass}">${ch?.name || channelId}</span>`;
}

function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

function confirmAction({ label, title, details = [], warning, confirmText, cancelText = "취소", type = "delete" }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirm-overlay");
    const header = document.getElementById("confirm-header");
    const icon = document.getElementById("confirm-icon");
    const labelEl = document.getElementById("confirm-label");
    const titleEl = document.getElementById("confirm-title");
    const detailsEl = document.getElementById("confirm-details");
    const warningEl = document.getElementById("confirm-warning");
    const cancelBtn = document.getElementById("confirm-cancel");
    const okBtn = document.getElementById("confirm-ok");

    header.className = `confirm-header ${type}`;
    icon.textContent = type === "restore" ? "↩️" : "🗑️";
    labelEl.textContent = label;
    titleEl.textContent = title;
    warningEl.textContent = warning;

    detailsEl.innerHTML = details
      .filter(Boolean)
      .map((line) => `<li>${line}</li>`)
      .join("");

    okBtn.textContent = confirmText;
    okBtn.className = `btn btn-lg ${type === "restore" ? "btn-warning" : "btn-danger"}`;

    const close = (result) => {
      overlay.hidden = true;
      cancelBtn.removeEventListener("click", onCancel);
      okBtn.removeEventListener("click", onOk);
      overlay.removeEventListener("click", onOverlay);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onCancel = () => close(false);
    const onOk = () => close(true);
    const onOverlay = (e) => {
      if (e.target === overlay) close(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
    };

    cancelBtn.addEventListener("click", onCancel);
    okBtn.addEventListener("click", onOk);
    overlay.addEventListener("click", onOverlay);
    document.addEventListener("keydown", onKey);

    overlay.hidden = false;
    cancelBtn.focus();
  });
}

function confirmDelete(title, detail) {
  const details = [];
  if (detail) {
    detail.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("※")) {
        details.push(`<span style="color:#b45309">${trimmed}</span>`);
      } else if (trimmed.includes(":")) {
        const [key, ...rest] = trimmed.split(":");
        details.push(`<strong>${key.trim()}</strong>: ${rest.join(":").trim()}`);
      } else {
        details.push(trimmed);
      }
    });
  }
  return confirmAction({
    label: "삭제 확인",
    title,
    details,
    warning: "삭제하면 되돌릴 수 없습니다. 정말 삭제하시겠습니까?",
    confirmText: "삭제하기",
    type: "delete",
  });
}

function confirmRestore(title, detail) {
  const details = detail ? detail.split("\n").filter(Boolean) : [];
  return confirmAction({
    label: "복원 확인",
    title,
    details,
    warning: "현재 내용이 처음 값으로 바뀝니다. 계속하시겠습니까?",
    confirmText: "복원하기",
    type: "restore",
  });
}

function setupGlobalDeleteHandlers() {
  const content = document.getElementById("content");
  if (!content || content.dataset.deleteBound) return;
  content.dataset.deleteBound = "1";

  content.addEventListener("click", async (e) => {
    const pdfBtn = e.target.closest("[data-pdf-id]");
    if (pdfBtn) {
      const proposal = getProposalById(appData, pdfBtn.dataset.pdfId);
      if (proposal) {
        showToast("PDF 생성 중...");
        exportProposalToPdf(proposal)
          .then(() => showToast("PDF 저장 완료"))
          .catch((err) => {
            console.error(err);
            showToast("PDF 생성에 실패했습니다");
          });
      }
      return;
    }

    const excelBtn = e.target.closest("[data-excel-id]");
    if (excelBtn) {
      const proposal = getProposalById(appData, excelBtn.dataset.excelId);
      if (proposal) {
        exportProposalToExcel(proposal);
        showToast("엑셀 파일 다운로드 중...");
      }
      return;
    }

    const proposalBtn = e.target.closest("[data-delete-proposal]");
    if (proposalBtn) {
      const id = proposalBtn.dataset.deleteProposal;
      const proposal = getProposalById(appData, id);
      if (!proposal) return;
      const ch = getChannelList().find((c) => c.id === proposal.channelId);
      if (
        !(await confirmDelete(
          getRecordType(proposal) === "order" ? "발주서 삭제" : "단가표 삭제",
          `업체: ${proposal.clientName}\n판매국가: ${ch?.name}\n버전: v${proposal.version}\n작성일: ${proposal.poDate}`
        ))
      ) {
        return;
      }
      const result = deleteProposal(appData, id);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      showToast(getRecordType(proposal) === "order" ? "발주서가 삭제되었습니다" : "단가표가 삭제되었습니다");
      render();
    }
  });
}

const PAGE_META = {
  dashboard: { title: "홈", desc: "Barle 영업 관리 홈입니다. 단가표·발주가 메인 업무이고, 데이터 등록은 처음 한 번만 설정하면 됩니다." },
  proposal: { title: "단가표 만들기", desc: "바이어에게 보낼 견적 · 가격표를 작성합니다. 저장해도 매출에는 반영되지 않습니다." },
  poupload: { title: "발주서 등록", desc: "수기 입력 또는 파일 업로드로 발주를 등록합니다. 저장 시 영업 현황에 반영됩니다." },
  products: { title: "제품 등록", desc: "품목·물류·기준 가격을 등록·수정합니다. 여기 입력한 소비자가가 단가표·발주서의 기준이 됩니다." },
  master: {
    title: "거래처 통합 등록",
    desc: "판매국가, 거래 업체, 거래 조건을 한 화면에서 등록·수정합니다.",
  },
  history: { title: "지난 단가표", desc: "저장된 견적 · 가격표 이력을 확인합니다." },
  sales: { title: "영업 현황", desc: "월별 발주 건수와 금액을 국가·업체별로 확인합니다." },
};

function parseViewFromHash() {
  const hash = location.hash.replace(/^#/, "").trim();
  if (!hash) return "dashboard";
  if (hash === "channels" || hash === "clients" || hash === "terms") return "master";
  if (hash === "srp") return "products";
  return PAGE_META[hash] ? hash : "dashboard";
}

function updateTopbarNav() {
  const onHome = currentView === "dashboard";
  const backBtn = document.getElementById("btn-nav-back");
  const homeBtn = document.getElementById("btn-nav-home");
  if (backBtn) backBtn.hidden = onHome;
  if (homeBtn) homeBtn.hidden = onHome;
}

function setView(view, options = {}) {
  const { skipHistory = false } = options;
  if (view === "channels" || view === "clients" || view === "terms") view = "master";

  if (!skipHistory && view !== currentView) {
    history.pushState({ view }, "", `#${view}`);
  }

  currentView = view;
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });
  const meta = PAGE_META[view] || { title: "Barle 영업 관리", desc: "" };
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-desc").textContent = meta.desc;
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-overlay")?.classList.remove("open");
  updateTopbarNav();
  try {
    render();
  } catch (err) {
    console.error(err);
    const content = document.getElementById("content");
    if (content) {
      content.innerHTML = `<div class="card"><div class="empty-state">화면을 불러오지 못했습니다. Cmd+Shift+R로 새로고침해주세요.</div></div>`;
    }
    showToast("화면 로딩 오류 — 새로고침 해주세요");
  }
}

function goBack() {
  if (currentView === "dashboard") return;
  if (history.length > 1) {
    history.back();
    return;
  }
  goHome();
}

function goHome() {
  setView("dashboard", { skipHistory: true });
  history.replaceState({ view: "dashboard" }, "", "#dashboard");
  updateTopbarNav();
}

function render() {
  const content = document.getElementById("content");
  if (!content) return;
  try {
    switch (currentView) {
      case "dashboard":
        content.innerHTML = renderDashboard();
        break;
      case "proposal":
        content.innerHTML = renderProposal();
        bindProposalEvents();
        break;
      case "poupload":
        content.innerHTML = renderPoUpload();
        bindPoUploadEvents();
        break;
      case "products":
        content.innerHTML = renderProducts();
        bindProductEvents();
        break;
      case "master":
        content.innerHTML = renderMaster();
        bindMasterEvents();
        break;
      case "history":
        content.innerHTML = renderHistory();
        bindHistoryEvents();
        break;
      case "sales":
        content.innerHTML = renderSales();
        bindSalesEvents();
        break;
      default:
        content.innerHTML = `<div class="card"><div class="empty-state">알 수 없는 화면입니다.</div></div>`;
    }
  } catch (err) {
    console.error("render error:", currentView, err);
    content.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">⚠️</div>화면을 불러오지 못했습니다.<br><small>${escapeAttr(err.message)}</small><br><button class="btn btn-primary" style="margin-top:16px" onclick="location.reload()">새로고침</button></div></div>`;
    showToast("화면 오류 — 새로고침 해주세요");
  }
}

function renderChannelOptions(selectedId) {
  return getChannelList()
    .map(
      (ch) =>
        `<option value="${ch.id}" ${ch.id === selectedId ? "selected" : ""}>${ch.name}</option>`
    )
    .join("");
}

function refreshProposalClientSelect(clientId, clientName) {
  const clientSelect = document.getElementById("client-select");
  if (!clientSelect) return;
  clientSelect.innerHTML = getClientSelectOptions(proposalState.channelId, clientId, clientName);
  proposalState.clientId = clientId || "";
  proposalState.clientName = clientName || "";
  if (clientId) clientSelect.value = clientId;
}

function openAddClientModal(prefillChannelId, onRegistered, prefillName) {
  const overlay = document.getElementById("client-modal-overlay");
  const form = document.getElementById("quick-client-form");
  const channelSelect = document.getElementById("quick-client-channel");
  if (!overlay || !form || !channelSelect) return;

  channelSelect.innerHTML = renderChannelOptions(prefillChannelId || proposalState.channelId);
  form.reset();
  if (prefillChannelId) channelSelect.value = prefillChannelId;
  if (prefillName) form.querySelector('[name="name"]').value = prefillName;
  quickClientCallback = onRegistered || null;
  overlay.hidden = false;
  form.querySelector('[name="name"]')?.focus();
}

function closeAddClientModal() {
  const overlay = document.getElementById("client-modal-overlay");
  if (overlay) overlay.hidden = true;
  quickClientCallback = null;
}

function setupClientModal() {
  const overlay = document.getElementById("client-modal-overlay");
  const form = document.getElementById("quick-client-form");
  const cancelBtn = document.getElementById("client-modal-cancel");
  if (!overlay || !form) return;

  cancelBtn?.addEventListener("click", closeAddClientModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeAddClientModal();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get("name")?.toString().trim() || "";
    const channelId = fd.get("channelId")?.toString() || "";
    const result = addClient(appData, {
      channelId,
      name,
      contact: fd.get("contact"),
      memo: fd.get("memo"),
    });
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    showToast(`"${name}" 업체가 등록되었습니다`);
    const callback = quickClientCallback;
    closeAddClientModal();
    const added = getClients(appData, channelId).find((c) => c.name === name);
    if (callback) {
      callback({ name, channelId, clientId: added?.id || "" });
    } else if (currentView === "master") {
      render();
    }
  });
}

function renderDashboard() {
  const products = getProducts(appData);
  const channels = getChannelList();
  const totalQuotes = getQuotes(appData).length;

  return `
    <div class="dashboard-hero no-print">
      <p class="dashboard-hero-eyebrow">Barle Cosmetics</p>
      <h2>영업 관리 홈</h2>
      <p>단가표 작성과 발주서 등록이 메인 업무입니다. 아래에서 바로 시작하거나, 데이터 등록을 먼저 설정하세요.</p>
    </div>

    <div class="dashboard-section no-print">
      <p class="dashboard-section-label">메인 업무</p>
      <div class="action-grid action-grid-main">
        <button class="action-card primary" onclick="setView('proposal')">
          <div class="action-icon">📋</div>
          <div class="action-title">단가표 만들기</div>
          <div class="action-desc">바이어에게 보낼 견적 · 가격표 작성</div>
        </button>
        <button class="action-card primary-alt" onclick="setView('poupload')">
          <div class="action-icon">🧾</div>
          <div class="action-title">발주서 등록</div>
          <div class="action-desc">수기 입력 · 파일 업로드 → 영업 현황 반영</div>
        </button>
      </div>
    </div>

    <div class="dashboard-section no-print">
      <p class="dashboard-section-label dashboard-section-label-muted">업무 조회</p>
      <div class="action-grid action-grid-sub">
        <button class="action-card" onclick="setView('history')">
          <div class="action-icon">🕐</div>
          <div class="action-title">지난 단가표</div>
          <div class="action-desc">저장된 견적 이력 확인</div>
        </button>
        <button class="action-card" onclick="setView('sales')">
          <div class="action-icon">📈</div>
          <div class="action-title">영업 현황</div>
          <div class="action-desc">월별 발주 · 매출 집계</div>
        </button>
      </div>
    </div>

    <div class="dashboard-section no-print">
      <p class="dashboard-section-label dashboard-section-label-muted">데이터 등록</p>
      <div class="dashboard-data-panel">
        <p class="dashboard-data-hint">메인 업무 전에 한 번만 설정하면 됩니다</p>
        <div class="action-grid action-grid-data">
          <button class="action-card data-card" onclick="setView('products')">
            <div class="action-icon">📦</div>
            <div class="action-title">제품 등록</div>
            <div class="action-desc">품목 · 기준 가격</div>
          </button>
          <button class="action-card data-card" onclick="openMaster('')">
            <div class="action-icon">🌐</div>
            <div class="action-title">거래처 통합 등록</div>
            <div class="action-desc">국가 · 업체 · 거래조건</div>
          </button>
          <button class="action-card data-card" onclick="openMaster('')">
            <div class="action-icon">✨</div>
            <div class="action-title">처음 설정</div>
            <div class="action-desc">국가 · 업체 등록부터 시작</div>
          </button>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">등록된 제품</div>
        <div class="value">${products.length}<span style="font-size:16px">개</span></div>
      </div>
      <div class="stat-card">
        <div class="label">관리 국가</div>
        <div class="value">${channels.length}<span style="font-size:16px">개</span></div>
        <div class="sub">${channels.map((c) => c.name).join(" · ")}</div>
      </div>
      <div class="stat-card">
        <div class="label">저장된 단가표</div>
        <div class="value">${totalQuotes}<span style="font-size:16px">건</span></div>
      </div>
      <div class="stat-card">
        <div class="label">최근 작성일</div>
        <div class="value" style="font-size:18px;padding-top:4px">
          ${getQuotes(appData)[0] ? new Date(getQuotes(appData)[0].createdAt).toLocaleDateString("ko-KR") : "—"}
        </div>
        <div class="sub">${getQuotes(appData)[0]?.clientName || "아직 없음"}</div>
      </div>
    </div>
  `;
}

function getClientSelectOptions(channelId, selectedClientId, selectedName) {
  const clients = getClients(appData, channelId);
  const options = clients
    .map(
      (c) =>
        `<option value="${escapeAttr(c.id)}" ${c.id === selectedClientId ? "selected" : ""}>${escapeAttr(c.name)}</option>`
    )
    .join("");
  const isRegistered = selectedClientId && clients.some((c) => c.id === selectedClientId);
  const legacyOption =
    selectedName && !isRegistered
      ? `<option value="" data-legacy-name="${escapeAttr(selectedName)}" selected>${escapeAttr(selectedName)} (미등록)</option>`
      : "";
  return `
    <option value="">업체를 선택하세요</option>
    ${options}
    ${legacyOption}
  `;
}

function resolveClientFromSelect(channelId, selectValue, fallbackName) {
  const clients = getClients(appData, channelId);
  const client = clients.find((c) => c.id === selectValue);
  if (client) {
    return { clientId: client.id, clientName: client.name };
  }
  const legacyName = String(fallbackName || "").trim();
  return { clientId: "", clientName: legacyName };
}

function readPoFormFromDom() {
  const channelId = document.getElementById("po-channel-select")?.value?.trim() || "";
  const clientSelect = document.getElementById("po-client-select");
  const legacyName = clientSelect?.selectedOptions?.[0]?.dataset?.legacyName || "";
  const resolved = resolveClientFromSelect(channelId, clientSelect?.value?.trim() || "", legacyName);
  const poDate = document.getElementById("po-date")?.value || "";
  const poNumber = document.getElementById("po-number")?.value?.trim() || "";

  if (!channelId) return { error: "판매 국가를 선택해주세요" };
  if (!resolved.clientName) return { error: "업체를 선택하거나 + 신규로 등록해주세요" };
  if (!poDate) return { error: "발주일을 입력해주세요" };

  return {
    channelId,
    buyerName: resolved.clientName,
    clientId: resolved.clientId || null,
    clientName: resolved.clientName,
    poDate,
    poNumber,
  };
}

function readProposalClientFromDom() {
  const channelSelect = document.getElementById("channel-select");
  const clientSelect = document.getElementById("client-select");
  const channelId = channelSelect?.value || "";
  const clientId = clientSelect?.value || "";
  if (!channelId || !clientId) return null;
  const client = getClients(appData, channelId).find((c) => c.id === clientId);
  if (!client) return null;
  return { channelId, clientId: client.id, clientName: client.name };
}

function renderProposal() {
  const channel = getChannelList().find((c) => c.id === proposalState.channelId);
  const products = getProducts(appData);
  const terms = getChannelTerms(appData, proposalState.channelId);
  const channelClients = getClients(appData, proposalState.channelId);
  let totalAmount = 0;
  let totalCtn = 0;
  let totalCbm = 0;

  const rows = products.map((p) => {
    const item = proposalState.items[p.code] || { srpKrw: null, srpUsd: null, poQty: 0 };
    const { fobUsd, fobKrw } = calcFobFromSrp(
      item.srpKrw,
      item.srpUsd,
      proposalState.fobRate,
      proposalState.exchangeRate
    );
    const ctn = calcCtn(item.poQty, p.cartonQty);
    const cbmQty = calcCbmQty(ctn, p.cbm);
    const amount = calcAmount(fobUsd, fobKrw, item.poQty, channel);
    totalAmount += amount;
    totalCtn += ctn;
    totalCbm += cbmQty;

    return `
      <tr data-code="${p.code}">
        <td>${p.category}</td>
        <td><strong>${p.nameKor}</strong></td>
        <td><code>${p.code}</code></td>
        <td>${p.size}</td>
        <td class="editable">
          <input class="input-cell srp" type="number" step="1" min="0"
            data-field="srpKrw" data-code="${p.code}"
            value="${item.srpKrw ?? ""}" placeholder="미입력">
        </td>
        <td class="editable">
          <input class="input-cell srp" type="number" step="0.01" min="0"
            data-field="srpUsd" data-code="${p.code}"
            value="${item.srpUsd ?? ""}" placeholder="미입력">
        </td>
        <td class="auto" data-fob-krw="${p.code}">${formatKrw(fobKrw)}</td>
        <td class="auto" data-fob-usd="${p.code}">${formatUsd(fobUsd)}</td>
        <td>${p.moq}</td>
        <td class="editable">
          <input class="input-cell qty" type="number" step="1" min="0"
            data-field="poQty" data-code="${p.code}" value="${item.poQty || ""}" placeholder="0">
        </td>
        <td class="auto" data-ctn="${p.code}">${formatNumber(ctn, 2)}</td>
        <td class="auto" data-cbm="${p.code}">${formatNumber(cbmQty, 4)}</td>
        <td class="auto" data-amount="${p.code}">${formatMoney(amount, channel)}</td>
      </tr>`;
  }).join("");

  return `
    <div class="card">
      <div class="proposal-header">
        <h3>제품 가격표 (Price List)</h3>
        <p>Barle Cosmetics · ${channel.name}</p>
      </div>
    </div>

    <div class="help-box no-print">
      <span class="help-icon">💡</span>
      <div>
        <strong>단가표 = 견적</strong> · 바이어에게 보내는 가격표입니다. 저장해도 <strong>영업 현황(매출)에는 포함되지 않습니다.</strong><br>
        소비자가는 <strong>제품 등록</strong>의 기준 가격이 자동으로 채워집니다. 노란 칸만 직접 수정하세요.
      </div>
    </div>

    <div class="section-block no-print">
      <div class="section-label">① 기본 정보 입력</div>
      <div class="proposal-meta-panel">
        <div class="proposal-meta-fields">
          <div class="form-group">
            <label>판매 국가</label>
            <select id="channel-select">
              ${renderChannelOptions(proposalState.channelId)}
            </select>
          </div>
          <div class="form-group form-group-client">
            <label>업체명 <span class="required">*</span></label>
            <div class="input-with-action">
              <select id="client-select">
                ${getClientSelectOptions(proposalState.channelId, proposalState.clientId, proposalState.clientName)}
              </select>
              <button type="button" class="btn btn-secondary btn-compact" id="btn-quick-client">+ 신규</button>
            </div>
          </div>
          <div class="form-group">
            <label>작성일</label>
            <input type="date" id="po-date" value="${proposalState.poDate}">
          </div>
        </div>
        ${
          channelClients.length === 0
            ? `<p class="proposal-meta-hint">등록된 업체가 없습니다. <strong>+ 신규</strong> 버튼으로 추가하세요.</p>`
            : ""
        }
        <div class="proposal-meta-actions">
          <button type="button" class="btn btn-secondary" id="btn-pdf-proposal">📄 PDF 저장</button>
          <button type="button" class="btn btn-secondary" id="btn-print">🖨 인쇄</button>
          <button type="button" class="btn btn-success" id="btn-save">💾 저장하기</button>
        </div>
      </div>
    </div>

    <div class="section-block no-print">
      <div class="section-label">② 가격 비율 설정</div>
      <div class="settings-panel">
        <div class="setting-item">
          <label>FOB 비율 (%)</label>
          <input type="number" id="fob-rate" value="${proposalState.fobRate}" min="0" max="100" step="0.1">
        </div>
        <div class="setting-item">
          <label>환율 (1달러 = ?원)</label>
          <input type="number" id="exchange-rate" value="${proposalState.exchangeRate}" min="1" step="1">
        </div>
        <p class="setting-hint">
          소비자가 × FOB 비율 = FOB 가격 · 환율로 원화/달러 동시 계산
        </p>
      </div>
    </div>

    <div class="section-block">
      <div class="section-label">③ 제품별 가격</div>
      <div class="legend-bar no-print">
        <span class="legend-item"><span class="legend-swatch editable"></span> 직접 입력</span>
        <span class="legend-item"><span class="legend-swatch auto"></span> 자동 계산</span>
      </div>
      <div class="table-wrap">
        <table id="proposal-table">
          <thead>
            <tr>
              <th>분류</th>
              <th>제품명</th>
              <th>제품코드</th>
              <th>용량</th>
              <th class="col-editable">소비자가(₩)</th>
              <th class="col-editable">소비자가($)</th>
              <th class="col-auto">FOB(₩)</th>
              <th class="col-auto">FOB($)</th>
              <th>최소주문</th>
              <th class="col-editable">주문수량</th>
              <th class="col-auto">박스수</th>
              <th class="col-auto">부피(CBM)</th>
              <th class="col-auto">금액</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="10" style="text-align:right;font-weight:700;padding:14px">합계</td>
              <td class="total-row" id="total-ctn">${formatNumber(totalCtn, 2)}</td>
              <td class="total-row" id="total-cbm">${formatNumber(totalCbm, 4)}</td>
              <td class="total-row" id="total-amount">${formatMoney(totalAmount, channel)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <div class="terms-box">
      <h4>거래 조건 (Terms & Conditions) — ${channel.name}</h4>
      ${terms.map((t) => `<p>${t}</p>`).join("")}
      <p class="no-print" style="margin-top:12px;font-size:13px;color:var(--text-muted)">
        거래 조건을 바꾸려면 왼쪽 메뉴 <strong>데이터 관리 → 국가·업체·거래조건</strong>에서 수정하세요.
      </p>
    </div>
  `;
}

function bindProposalEvents() {
  const channel = getChannelList().find((c) => c.id === proposalState.channelId);

  document.getElementById("channel-select").addEventListener("change", (e) => {
    initProposalState(e.target.value);
    proposalState.clientId = "";
    proposalState.clientName = "";
    render();
  });

  const clientSelect = document.getElementById("client-select");

  if (clientSelect) {
    clientSelect.addEventListener("change", (e) => {
      const resolved = resolveClientFromSelect(proposalState.channelId, e.target.value, "");
      proposalState.clientId = resolved.clientId;
      proposalState.clientName = resolved.clientName;
    });
  }

  document.getElementById("btn-quick-client")?.addEventListener("click", () => {
    openAddClientModal(proposalState.channelId, ({ name, channelId, clientId }) => {
      if (channelId !== proposalState.channelId) {
        initProposalState(channelId);
        proposalState.clientId = clientId || "";
        proposalState.clientName = name;
        render();
        return;
      }
      refreshProposalClientSelect(clientId, name);
    });
  });

  document.getElementById("po-date").addEventListener("change", (e) => {
    proposalState.poDate = e.target.value;
  });

  document.getElementById("fob-rate").addEventListener("input", (e) => {
    proposalState.fobRate = parseFloat(e.target.value) || 0;
    updateProposalCalcs(channel);
  });

  document.getElementById("exchange-rate").addEventListener("input", (e) => {
    proposalState.exchangeRate = parseFloat(e.target.value) || DEFAULT_EXCHANGE_RATE;
    appData.exchangeRate = proposalState.exchangeRate;
    saveData(appData);
    updateProposalCalcs(channel);
  });

  document.querySelectorAll("#proposal-table input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const code = e.target.dataset.code;
      const field = e.target.dataset.field;
      if (field === "poQty") {
        proposalState.items[code][field] = parseFloat(e.target.value) || 0;
      } else {
        proposalState.items[code][field] = parseOptionalNumber(e.target.value);
      }
      updateProposalCalcs(channel);
    });
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    const selected = readProposalClientFromDom();
    if (!selected) {
      showToast("업체를 선택해주세요");
      return;
    }
    proposalState.channelId = selected.channelId;
    proposalState.clientId = selected.clientId;
    proposalState.clientName = selected.clientName;
    const channel = findChannel(selected.channelId);
    const products = getProducts(appData);
    const terms = getChannelTerms(appData, proposalState.channelId);
    const items = products.map((p) => {
      const item = proposalState.items[p.code] || { srpKrw: null, srpUsd: null, poQty: 0 };
      const { fobUsd, fobKrw } = calcFobFromSrp(
        item.srpKrw,
        item.srpUsd,
        proposalState.fobRate,
        proposalState.exchangeRate
      );
      return buildProposalItemSnapshot(p, item, proposalState, channel, fobUsd, fobKrw);
    });
    const totalAmount = items.reduce((s, i) => s + i.amount, 0);
    const version = saveProposal(appData, {
      channelId: selected.channelId,
      clientId: selected.clientId,
      clientName: selected.clientName,
      poDate: proposalState.poDate,
      fobRate: proposalState.fobRate,
      exchangeRate: proposalState.exchangeRate,
      items,
      totalAmount,
      terms,
      recordType: "quote",
    });
    showToast(`단가표 저장 완료 — v${version} (지난 단가표에서 확인)`);
  });

  document.getElementById("btn-print").addEventListener("click", () => window.print());

  document.getElementById("btn-pdf-proposal")?.addEventListener("click", async () => {
    if (!proposalState.clientName.trim()) {
      showToast("업체를 선택한 뒤 PDF를 저장하세요");
      return;
    }
    try {
      showToast("PDF 생성 중...");
      const products = getProducts(appData);
      const terms = getChannelTerms(appData, proposalState.channelId);
      const items = products.map((p) => {
        const item = proposalState.items[p.code] || { srpKrw: null, srpUsd: null, poQty: 0 };
        const { fobUsd, fobKrw } = calcFobFromSrp(
          item.srpKrw,
          item.srpUsd,
          proposalState.fobRate,
          proposalState.exchangeRate
        );
        return buildProposalItemSnapshot(p, item, proposalState, channel, fobUsd, fobKrw);
      });
      const draftProposal = {
        channelId: proposalState.channelId,
        clientName: proposalState.clientName,
        poDate: proposalState.poDate,
        fobRate: proposalState.fobRate,
        exchangeRate: proposalState.exchangeRate,
        version: "draft",
        items,
        totalAmount: items.reduce((s, i) => s + i.amount, 0),
        terms,
      };
      await exportProposalToPdf(draftProposal);
      showToast("PDF 저장 완료");
    } catch (err) {
      console.error(err);
      showToast("PDF 생성에 실패했습니다");
    }
  });
}

function updateProposalCalcs(channel) {
  let totalAmount = 0;
  let totalCtn = 0;
  let totalCbm = 0;

  const products = getProducts(appData);
  products.forEach((p) => {
    const item = proposalState.items[p.code] || { srpKrw: null, srpUsd: null, poQty: 0 };
    const { fobUsd, fobKrw } = calcFobFromSrp(
      item.srpKrw,
      item.srpUsd,
      proposalState.fobRate,
      proposalState.exchangeRate
    );
    const ctn = calcCtn(item.poQty, p.cartonQty);
    const cbmQty = calcCbmQty(ctn, p.cbm);
    const amount = calcAmount(fobUsd, fobKrw, item.poQty, channel);
    totalAmount += amount;
    totalCtn += ctn;
    totalCbm += cbmQty;

    const fobKrwEl = document.querySelector(`[data-fob-krw="${p.code}"]`);
    const fobUsdEl = document.querySelector(`[data-fob-usd="${p.code}"]`);
    const ctnEl = document.querySelector(`[data-ctn="${p.code}"]`);
    const cbmEl = document.querySelector(`[data-cbm="${p.code}"]`);
    const amtEl = document.querySelector(`[data-amount="${p.code}"]`);
    if (fobKrwEl) fobKrwEl.textContent = formatKrw(fobKrw);
    if (fobUsdEl) fobUsdEl.textContent = formatUsd(fobUsd);
    if (ctnEl) ctnEl.textContent = formatNumber(ctn, 2);
    if (cbmEl) cbmEl.textContent = formatNumber(cbmQty, 4);
    if (amtEl) amtEl.textContent = formatMoney(amount, channel);
  });

  const totalAmtEl = document.getElementById("total-amount");
  const totalCtnEl = document.getElementById("total-ctn");
  const totalCbmEl = document.getElementById("total-cbm");
  if (totalAmtEl) totalAmtEl.textContent = formatMoney(totalAmount, channel);
  if (totalCtnEl) totalCtnEl.textContent = formatNumber(totalCtn, 2);
  if (totalCbmEl) totalCbmEl.textContent = formatNumber(totalCbm, 4);
}

function emptyPoRow() {
  return {
    name: "",
    qty: null,
    unitPrice: null,
    amount: null,
    matchedCode: null,
    matchedName: null,
  };
}

function mapParsedPoRows(rows) {
  const products = getProducts(appData);
  return (rows || []).map((r) => {
    const matchedCode = matchPoProduct(products, { barcode: r.barcode, name: r.name });
    const product = products.find((p) => p.code === matchedCode);
    return {
      name: r.name || "",
      qty: r.qty ?? null,
      unitPrice: r.unitPrice ?? null,
      amount: r.amount ?? null,
      matchedCode: matchedCode || null,
      matchedName: product ? product.nameKor : null,
    };
  });
}

function getPoFileDisplayCurrency(channel) {
  return poUploadState.detectedCurrency || channel.currency;
}

function renderPoReviewSection(channel, rows) {
  const totalAmount = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const displayCurrency = getPoFileDisplayCurrency(channel);
  const buyerName = poUploadState.clientName?.trim() || "";
  const clientHint = buyerName
    ? `<p class="po-save-client-hint">저장 업체: <strong>${escapeAttr(buyerName)}</strong> · ${escapeAttr(channel.name)}</p>`
    : `<p class="po-save-client-hint po-save-client-warn">⚠️ 저장 전 업체를 선택하거나 + 신규로 등록해주세요</p>`;
  const currencyHint = poUploadState.detectedCurrency
    ? `<p class="po-save-client-hint">인식된 통화: <strong>${escapeAttr(poUploadState.detectedCurrency)}</strong> (₩/KRW·$/USD 표기를 기준으로 자동 인식)</p>`
    : "";
  return `
    <div class="section-block">
      <div class="section-label">④ ${rows.length ? `인식 결과 (${rows.length}건)` : "품목 입력"}</div>
      ${clientHint}
      ${currencyHint}
      <div class="table-wrap">
        <table class="po-review-table">
          <thead>
            <tr>
              <th>품명(원문)</th>
              <th>등록 제품 매칭</th>
              <th>발주수량</th>
              <th>단가</th>
              <th>금액</th>
              <th class="no-print"></th>
            </tr>
          </thead>
          <tbody id="po-review-body">
            ${rows.length ? rows.map((r, i) => renderPoRow(r, i)).join("") : `<tr><td colspan="6" class="po-empty-hint">+ 행 추가 버튼으로 품명·발주수량·단가·금액을 입력하세요</td></tr>`}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="text-align:right;font-weight:700">합계</td>
              <td class="total-row" id="po-total-amount">${formatByCurrency(totalAmount, displayCurrency)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
        <button class="btn btn-secondary" id="po-btn-add-row">+ 행 추가</button>
        <button class="btn btn-success btn-lg" id="po-btn-save">💾 저장하고 영업 현황 반영</button>
      </div>
    </div>
  `;
}

function renderPoRow(r, i) {
  const products = getProducts(appData);
  const matched = !!r.matchedCode;
  return `
    <tr data-row-index="${i}" class="${matched ? "" : "po-row-unmatched"}">
      <td class="editable">
        <input class="input-cell po-name-input" type="text" data-po-field="name" data-row-index="${i}" value="${(r.name || "").replace(/"/g, "&quot;")}" placeholder="품명(영문도 가능)">
      </td>
      <td class="editable">
        <select class="input-cell" data-po-field="matchedCode" data-row-index="${i}">
          <option value="">${matched ? "매칭 안됨으로 변경" : "-- 등록 제품 선택 --"}</option>
          ${products
            .map(
              (p) =>
                `<option value="${escapeAttr(p.code)}" ${p.code === r.matchedCode ? "selected" : ""}>${escapeAttr(p.nameKor)}</option>`
            )
            .join("")}
        </select>
        ${!matched ? `<span class="field-hint po-hint-warn">등록된 제품과 자동으로 매칭되지 않았습니다. 직접 선택해주세요.</span>` : ""}
      </td>
      <td class="editable">
        <input class="input-cell" type="number" step="1" min="0" data-po-field="qty" data-row-index="${i}" value="${r.qty ?? ""}" placeholder="0">
      </td>
      <td class="editable">
        <input class="input-cell" type="number" step="1" min="0" data-po-field="unitPrice" data-row-index="${i}" value="${r.unitPrice ?? ""}" placeholder="0">
      </td>
      <td class="editable">
        <input class="input-cell" type="number" step="1" min="0" data-po-field="amount" data-row-index="${i}" value="${r.amount ?? ""}" placeholder="0">
      </td>
      <td class="no-print"><button class="btn btn-danger btn-sm" data-po-remove-row="${i}">삭제</button></td>
    </tr>
  `;
}

function getPoManualExchangeRate() {
  return appData.exchangeRate || DEFAULT_EXCHANGE_RATE;
}

function getPoManualJpyRate() {
  return appData.jpyPerUsd || DEFAULT_JPY_PER_USD;
}

function formatPoManualMoney(amount) {
  return formatByCurrency(amount, poUploadState.manualPriceCurrency);
}

function convertPoManualPrice(price, from, to) {
  if (price == null || from === to) return price;
  const krwRate = getPoManualExchangeRate();
  const jpyRate = getPoManualJpyRate();

  let usd;
  if (from === "USD") usd = price;
  else if (from === "KRW") usd = price / krwRate;
  else usd = price / jpyRate;

  if (to === "USD") return Math.round(usd * 100) / 100;
  if (to === "KRW") return Math.round(usd * krwRate);
  return Math.round(usd * jpyRate);
}

function resolvePoManualUnitPriceUsd(product) {
  if (product?.fobUsd != null && product.fobUsd > 0) return product.fobUsd;
  if (product?.srpUsd != null && product.srpUsd > 0) return product.srpUsd;
  return null;
}

function resolvePoManualUnitPrice(code, currency) {
  const product = getProducts(appData).find((p) => p.code === code);
  const rate = getPoManualExchangeRate();

  if (currency === "KRW") {
    if (product?.srpKrw != null && product.srpKrw > 0) return product.srpKrw;
    const usd = resolvePoManualUnitPriceUsd(product);
    return usd != null ? Math.round(usd * rate) : null;
  }

  if (currency === "JPY") {
    const jpyRate = getPoManualJpyRate();
    const usd = resolvePoManualUnitPriceUsd(product);
    return usd != null ? Math.round(usd * jpyRate) : null;
  }

  return resolvePoManualUnitPriceUsd(product);
}

function createPoManualItem(code) {
  const currency = poUploadState.manualPriceCurrency;
  const unitPrice = resolvePoManualUnitPrice(code, currency);
  return { qty: 0, unitPrice, amount: 0 };
}

function ensurePoManualItemDefaults(code) {
  if (!poUploadState.manualItems[code]) {
    poUploadState.manualItems[code] = createPoManualItem(code);
    return;
  }
  const currency = poUploadState.manualPriceCurrency;
  if (poUploadState.manualItems[code].unitPrice == null) {
    poUploadState.manualItems[code].unitPrice = resolvePoManualUnitPrice(code, currency);
  }
}

function addPoManualProduct(code) {
  if (!poUploadState.manualSelected.includes(code)) {
    poUploadState.manualSelected.push(code);
  }
  if (!poUploadState.manualItems[code]) {
    poUploadState.manualItems[code] = createPoManualItem(code);
  }
}

function removePoManualProduct(code) {
  poUploadState.manualSelected = poUploadState.manualSelected.filter((c) => c !== code);
  delete poUploadState.manualItems[code];
}

function switchPoManualCurrency(currency) {
  if (poUploadState.manualPriceCurrency === currency) return;
  const from = poUploadState.manualPriceCurrency;
  poUploadState.manualSelected.forEach((code) => {
    ensurePoManualItemDefaults(code);
    const item = poUploadState.manualItems[code];
    if (!item) return;
    if (item.unitPrice != null) {
      item.unitPrice = convertPoManualPrice(item.unitPrice, from, currency);
    } else {
      item.unitPrice = resolvePoManualUnitPrice(code, currency);
    }
    const qty = item.qty || 0;
    item.amount = qty > 0 && item.unitPrice != null ? qty * item.unitPrice : 0;
  });
  poUploadState.manualPriceCurrency = currency;
}

function updatePoManualCalcs() {
  let totalAmount = 0;
  poUploadState.manualSelected.forEach((code) => {
    const item = poUploadState.manualItems[code] || { qty: 0, unitPrice: null, amount: 0 };
    const qty = item.qty || 0;
    const unitPrice = item.unitPrice;
    const amount = unitPrice != null && qty > 0 ? qty * unitPrice : 0;
    item.amount = amount;
    poUploadState.manualItems[code] = item;
    if (qty > 0) totalAmount += amount;

    const amountEl = document.querySelector(`[data-po-manual-amount="${code}"]`);
    if (amountEl) amountEl.textContent = formatPoManualMoney(amount);
  });
  const totalEl = document.getElementById("po-manual-total-amount");
  if (totalEl) totalEl.textContent = formatPoManualMoney(totalAmount);
}

function renderPoManualSection(channel) {
  const products = getProducts(appData);
  const currency = poUploadState.manualPriceCurrency;
  const unitLabel =
    currency === "KRW" ? "단가 (₩)" : currency === "JPY" ? "단가 (¥)" : "단가 ($)";
  const unitStep = currency === "USD" ? "0.01" : "1";

  let totalAmount = 0;
  const selectedRows = poUploadState.manualSelected
    .map((code) => {
      const p = products.find((x) => x.code === code);
      if (!p) return "";
      ensurePoManualItemDefaults(code);
      const item = poUploadState.manualItems[code] || { qty: 0, unitPrice: null, amount: 0 };
      const qty = item.qty || 0;
      const unitPrice = item.unitPrice;
      const amount = unitPrice != null && qty > 0 ? qty * unitPrice : 0;
      if (qty > 0) totalAmount += amount;
      return `
      <tr data-po-manual-code="${p.code}">
        <td><strong>${p.nameKor}</strong> <code class="po-row-code">${p.code}</code></td>
        <td class="editable">
          <input class="input-cell qty" type="number" step="1" min="0"
            data-po-manual-field="qty" data-code="${p.code}" value="${qty || ""}" placeholder="0">
        </td>
        <td class="editable">
          <input class="input-cell" type="number" step="${unitStep}" min="0"
            data-po-manual-field="unitPrice" data-code="${p.code}" value="${unitPrice ?? ""}" placeholder="0">
        </td>
        <td class="auto" data-po-manual-amount="${p.code}">${formatPoManualMoney(amount)}</td>
        <td class="no-print">
          <button type="button" class="btn btn-danger btn-sm" data-po-manual-remove="${p.code}">삭제</button>
        </td>
      </tr>`;
    })
    .join("");

  const productChips = products
    .map((p) => {
      const selected = poUploadState.manualSelected.includes(p.code);
      return `
      <button type="button" class="po-product-chip${selected ? " selected" : ""}" data-po-pick-product="${p.code}">
        ${selected ? "✓ " : ""}${p.nameKor}
      </button>`;
    })
    .join("");

  return `
    <div class="section-block">
      <div class="section-label">③ 발주 품목 선택 · 입력</div>

      <div class="po-manual-toolbar no-print">
        <div class="po-product-picker">
          <p class="po-picker-label">제품 클릭하여 추가</p>
          <div class="po-product-chips">${productChips}</div>
        </div>
        <div class="po-currency-toggle">
          <span class="po-currency-label">단가 통화</span>
          <button type="button" class="po-currency-btn${currency === "KRW" ? " active" : ""}" data-po-currency="KRW">₩ 원화</button>
          <button type="button" class="po-currency-btn${currency === "USD" ? " active" : ""}" data-po-currency="USD">$ 달러</button>
          <button type="button" class="po-currency-btn${currency === "JPY" ? " active" : ""}" data-po-currency="JPY">¥ 엔화</button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="po-manual-table">
          <thead>
            <tr>
              <th>제품명</th>
              <th>발주수량</th>
              <th>${unitLabel}</th>
              <th>금액</th>
              <th class="no-print"></th>
            </tr>
          </thead>
          <tbody>
            ${
              poUploadState.manualSelected.length
                ? selectedRows
                : `<tr><td colspan="5" class="po-empty-hint">위에서 발주할 제품을 클릭해 추가하세요</td></tr>`
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align:right;font-weight:700">합계</td>
              <td class="total-row" id="po-manual-total-amount">${formatPoManualMoney(totalAmount)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button class="btn btn-success btn-lg" id="po-btn-save">💾 저장하고 영업 현황 반영</button>
      </div>
    </div>
  `;
}

function renderPoUpload() {
  const channel = findChannel(poUploadState.channelId);
  const channelClients = getClients(appData, poUploadState.channelId);
  const rows = poUploadState.rows;
  const totalAmount = rows.reduce((s, r) => s + (r.amount ?? 0), 0);

  return `
    <div class="help-box no-print">
      <span class="help-icon">🧾</span>
      <div>
        <strong>발주서 = 매출</strong> · 실제 발주가 들어온 건을 등록합니다. 저장하면 <strong>영업 현황에 반영</strong>됩니다.<br>
        파일 업로드(PDF/엑셀/이미지) 또는 제품별 수기 입력 중 선택하세요.
      </div>
    </div>

    <div class="section-block no-print">
      <div class="section-label">① 국가·업체 입력</div>
      <div class="form-row po-meta-row">
        <div class="form-group">
          <label>판매 국가</label>
          <select id="po-channel-select">${renderChannelOptions(poUploadState.channelId)}</select>
        </div>
        <div class="form-group form-group-client">
          <label>업체명 <span class="required">*</span></label>
          <div class="input-with-action">
            <select id="po-client-select">
              ${getClientSelectOptions(poUploadState.channelId, poUploadState.clientId, poUploadState.clientName)}
            </select>
            <button type="button" class="btn btn-secondary" id="po-btn-quick-client">+ 신규</button>
          </div>
          ${
            channelClients.length === 0
              ? `<span class="field-hint">등록된 업체가 없습니다. <strong>+ 신규</strong> 버튼으로 추가하세요.</span>`
              : `<span class="field-hint">목록에서 업체를 선택하세요. 없으면 <strong>+ 신규</strong>로 등록하세요.</span>`
          }
        </div>
        <div class="form-group">
          <label>발주일</label>
          <input type="date" id="po-date" value="${poUploadState.poDate}">
        </div>
        <div class="form-group">
          <label>발주번호</label>
          <input type="text" id="po-number" placeholder="자동 인식 또는 직접 입력" value="${poUploadState.poNumber || ""}">
        </div>
      </div>
    </div>

    <div class="section-block no-print">
      <div class="section-label">② 입력 방식</div>
      <div class="po-mode-tabs">
        <button type="button" class="po-mode-tab${poUploadState.mode === "file" ? " active" : ""}" data-po-mode="file">📎 파일 업로드</button>
        <button type="button" class="po-mode-tab${poUploadState.mode === "manual" ? " active" : ""}" data-po-mode="manual">✏️ 수기 입력</button>
      </div>
    </div>

    ${
      poUploadState.mode === "manual"
        ? renderPoManualSection(channel)
        : `
    <div class="section-block no-print">
      <div class="section-label">③ 발주서 파일 업로드</div>
      <div class="po-dropzone" id="po-dropzone">
        <input type="file" id="po-file-input" accept=".xlsx,.xls,.csv,.pdf,image/*,.png,.jpg,.jpeg" hidden>
        <div class="po-dropzone-icon">📎</div>
        <p><strong>클릭하거나 파일을 끌어다 놓으세요</strong></p>
        <p class="po-dropzone-sub">PDF · 엑셀(.xlsx, .xls, .csv) · 이미지(사진, 스캔본)</p>
        ${poUploadState.fileName ? `<p class="po-dropzone-file">📄 ${poUploadState.fileName}</p>` : ""}
      </div>
      ${
        poUploadState.status === "parsing"
          ? `<div class="po-status po-status-parsing">${poUploadState.statusMsg || "인식 중..."}</div>`
          : ""
      }
      ${poUploadState.status === "error" ? `<div class="po-status po-status-error">⚠️ ${poUploadState.statusMsg}</div>` : ""}
      ${poUploadState.warning ? `<div class="po-status po-status-warn">⚠️ ${poUploadState.warning}</div>` : ""}
    </div>

    ${poUploadState.status === "done" || rows.length ? renderPoReviewSection(channel, rows) : ""}
    `
    }
  `;
}

function handlePoFile(file) {
  poUploadState.mode = "file";
  poUploadState.fileName = file.name;
  poUploadState.status = "parsing";
  poUploadState.statusMsg = "";
  poUploadState.warning = "";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
  poUploadState.fileKind = isPdf ? "pdf" : isImage ? "image" : "excel";
  render();

  const applyParsed = (parsed) => {
    poUploadState.rows = mapParsedPoRows(parsed.rows);
    if (parsed.poNumber) poUploadState.poNumber = parsed.poNumber;
    if (parsed.poDate) poUploadState.poDate = parsed.poDate;
    poUploadState.detectedCurrency = parsed.currency || null;
    if (parsed.isOliveYoung) {
      const oliveChannel = getChannelList().find((c) => c.id === "KR-OLIVE" || c.name === "올리브영");
      if (oliveChannel) poUploadState.channelId = oliveChannel.id;
      if (!poUploadState.clientName?.trim()) {
        const oliveClient = getClients(appData, poUploadState.channelId).find((c) => c.name === "올리브영");
        poUploadState.clientId = oliveClient?.id || "";
        poUploadState.clientName = "올리브영";
      }
    }
    poUploadState.warning = parsed.warning || "";
    if (!poUploadState.rows.length && (poUploadState.fileKind === "image" || poUploadState.fileKind === "pdf")) {
      poUploadState.rows = [emptyPoRow(), emptyPoRow(), emptyPoRow()];
    }
    poUploadState.status = "done";
    poUploadState.statusMsg = "";
    render();
  };

  const onFail = (err) => {
    poUploadState.status = "error";
    poUploadState.statusMsg = err.message || "파일을 인식하지 못했습니다.";
    render();
  };

  const updateParsingStatus = (m) => {
    if (!m?.status || m.progress == null) return;
    const labels = {
      "pdf-text": "PDF 텍스트 추출",
      "pdf-ocr": "PDF OCR 인식",
    };
    const label = labels[m.status] || (m.status === "recognizing text" ? "OCR 인식" : m.status);
    poUploadState.statusMsg = `${label}... (${Math.round(m.progress * 100)}%)`;
    const statusEl = document.querySelector(".po-status-parsing");
    if (statusEl) statusEl.textContent = poUploadState.statusMsg;
  };

  if (isPdf) {
    parsePoPdfFile(file, updateParsingStatus).then(applyParsed).catch(onFail);
  } else if (isImage) {
    parsePoImageFile(file, updateParsingStatus).then(applyParsed).catch(onFail);
  } else {
    parsePoExcelFile(file).then(applyParsed).catch(onFail);
  }
}

function updatePoTotals() {
  const channel = findChannel(poUploadState.channelId);
  const totalAmount = poUploadState.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const el = document.getElementById("po-total-amount");
  if (el) el.textContent = formatByCurrency(totalAmount, getPoFileDisplayCurrency(channel));
}

function updatePoSaveClientHint() {
  const hint = document.querySelector(".po-save-client-hint");
  if (!hint) return;
  const channelId = document.getElementById("po-channel-select")?.value || poUploadState.channelId;
  const channel = findChannel(channelId);
  const buyerName = poUploadState.clientName?.trim() || "";
  if (buyerName) {
    hint.className = "po-save-client-hint";
    hint.innerHTML = `저장 업체: <strong>${escapeAttr(buyerName)}</strong> · ${escapeAttr(channel.name)}`;
  } else {
    hint.className = "po-save-client-hint po-save-client-warn";
    hint.textContent = "⚠️ 저장 전 업체를 선택하거나 + 신규로 등록해주세요";
  }
}

async function savePoUpload() {
  const form = readPoFormFromDom();
  if (form.error) {
    showToast(form.error);
    return;
  }

  poUploadState.channelId = form.channelId;
  poUploadState.clientId = form.clientId || "";
  poUploadState.clientName = form.buyerName;
  poUploadState.poDate = form.poDate;
  poUploadState.poNumber = form.poNumber;

  const channel = findChannel(form.channelId);
  const terms = getChannelTerms(appData, form.channelId);
  const products = getProducts(appData);
  let items = [];
  let source = "po-upload";
  let filePriceCurrency = poUploadState.detectedCurrency || channel.currency;

  if (poUploadState.mode === "manual") {
    const currency = poUploadState.manualPriceCurrency;
    items = poUploadState.manualSelected
      .map((code) => {
        const p = products.find((x) => x.code === code);
        if (!p) return null;
        const item = poUploadState.manualItems[code] || { qty: 0, unitPrice: null, amount: 0 };
        const qty = item.qty || 0;
        const unitPrice = item.unitPrice;
        const amount = unitPrice != null && qty > 0 ? qty * unitPrice : 0;
        if (qty <= 0) return null;
        return {
          productCode: p.code,
          nameKor: p.nameKor,
          srpKrw: currency === "KRW" ? unitPrice : null,
          srpUsd: currency === "USD" ? unitPrice : null,
          srpJpy: currency === "JPY" ? unitPrice : null,
          fobRate: 0,
          fobUsd: null,
          fobKrw: null,
          poQty: qty,
          amount,
        };
      })
      .filter(Boolean);
    source = "po-manual";
    if (!items.length) {
      showToast("발주수량이 입력된 제품이 없습니다");
      return;
    }
  } else {
    const validRows = poUploadState.rows.filter(
      (r) => r.name?.trim() && r.qty != null && r.qty > 0 && r.amount != null && r.amount > 0
    );
    if (!validRows.length) {
      showToast("품명·발주수량·금액이 입력된 품목이 없습니다");
      return;
    }
    items = validRows.map((r, idx) => {
      const qty = r.qty;
      const unitPrice = r.unitPrice;
      const amount = r.amount ?? (unitPrice != null ? unitPrice * qty : 0);
      const currency = filePriceCurrency;
      const matchedProduct = r.matchedCode ? products.find((p) => p.code === r.matchedCode) : null;
      return {
        productCode: matchedProduct ? matchedProduct.code : `PO-${Date.now()}-${idx}`,
        nameKor: matchedProduct ? matchedProduct.nameKor : r.name.trim(),
        sourceName: r.name.trim(),
        srpKrw: currency === "KRW" ? unitPrice : null,
        srpUsd: currency === "USD" ? unitPrice : null,
        srpJpy: currency === "JPY" ? unitPrice : null,
        fobRate: 0,
        fobUsd: null,
        fobKrw: null,
        poQty: qty,
        amount,
      };
    });
  }

  const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
  const savedMonth = form.poDate.slice(0, 7);
  const savedChannelId = form.channelId;
  const existingOrder = findDuplicateOrder(appData, form.channelId, form.poNumber);
  const displayCurrency = poUploadState.mode === "manual" ? poUploadState.manualPriceCurrency : filePriceCurrency;

  const confirmed = await confirmAction({
    label: existingOrder ? "중복 발주번호 확인" : "발주 저장 확인",
    title: `${form.buyerName} · ${channel.name}`,
    details: [
      `발주일: ${form.poDate}`,
      `발주번호: ${form.poNumber || "—"}`,
      `합계: ${formatByCurrency(totalAmount, displayCurrency)}`,
      `품목: ${items.length}건`,
      existingOrder
        ? `※ 이미 등록된 발주번호입니다. 저장하면 기존 발주(${formatProposalMoney(existingOrder.totalAmount, existingOrder, channel)})를 덮어씁니다.`
        : "",
    ],
    warning: existingOrder
      ? "같은 발주번호가 이미 저장되어 있어 매출이 중복 집계될 수 있습니다. 저장하면 기존 발주를 덮어씁니다. 새 발주라면 발주번호를 다르게 입력해주세요."
      : "저장하면 영업 현황(매출)에 반영됩니다. 업체명·국가가 맞는지 확인해주세요.",
    confirmText: existingOrder ? "덮어쓰기" : "저장",
    cancelText: "취소",
    type: existingOrder ? "delete" : "restore",
  });
  if (!confirmed) return;

  if (existingOrder) {
    deleteProposal(appData, existingOrder.id);
  }

  const { version } = saveOrder(appData, {
    channelId: form.channelId,
    clientId: form.clientId,
    buyerName: form.buyerName,
    poDate: form.poDate,
    poNumber: form.poNumber,
    fobRate: 0,
    exchangeRate: appData.exchangeRate,
    priceCurrency: poUploadState.mode === "manual" ? poUploadState.manualPriceCurrency : filePriceCurrency,
    items,
    totalAmount,
    terms,
    source,
    sourceFileName: poUploadState.fileName,
  });

  const savedMonthLabel = `${savedMonth.slice(0, 4)}년 ${parseInt(savedMonth.slice(5, 7))}월`;
  showToast(`발주서가 저장되었습니다 — v${version} · ${form.buyerName} (${savedMonthLabel} 영업 현황 반영)`);
  poUploadState = freshPoUploadState();
  // 기존에 보고 있던 월·채널 필터는 유지한다. 저장된 발주의 월이 다르면
  // 화면이 그 월로 튀면서 다른 월의 기존 발주가 사라진 것처럼 보이는
  // 문제가 있었기 때문에, 필터는 그대로 두고 토스트로만 안내한다.
  if (!salesMonth) salesMonth = savedMonth;
  setView("sales");
}

function bindPoUploadEvents() {
  document.getElementById("po-channel-select").addEventListener("change", (e) => {
    poUploadState.channelId = e.target.value;
    poUploadState.clientId = "";
    poUploadState.clientName = "";
    if (poUploadState.mode === "manual") {
      poUploadState.manualSelected = [];
      poUploadState.manualItems = {};
    }
    render();
  });

  document.querySelectorAll("[data-po-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      poUploadState.mode = btn.dataset.poMode;
      render();
    });
  });

  document.querySelectorAll("[data-po-pick-product]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.poPickProduct;
      if (poUploadState.manualSelected.includes(code)) {
        removePoManualProduct(code);
      } else {
        addPoManualProduct(code);
      }
      render();
    });
  });

  document.querySelectorAll("[data-po-manual-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      removePoManualProduct(btn.dataset.poManualRemove);
      render();
    });
  });

  document.querySelectorAll("[data-po-currency]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchPoManualCurrency(btn.dataset.poCurrency);
      render();
    });
  });

  document.querySelectorAll("[data-po-manual-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const code = e.target.dataset.code;
      const field = e.target.dataset.poManualField;
      if (!poUploadState.manualItems[code]) {
        poUploadState.manualItems[code] = createPoManualItem(code);
      }
      poUploadState.manualItems[code][field] =
        field === "qty" ? parseFloat(e.target.value) || 0 : parseOptionalNumber(e.target.value);
      updatePoManualCalcs();
    });
  });

  const clientSelect = document.getElementById("po-client-select");
  if (clientSelect) {
    clientSelect.addEventListener("change", (e) => {
      const channelId = document.getElementById("po-channel-select")?.value || poUploadState.channelId;
      const legacyName = e.target.selectedOptions?.[0]?.dataset?.legacyName || "";
      const resolved = resolveClientFromSelect(channelId, e.target.value, legacyName);
      poUploadState.channelId = channelId;
      poUploadState.clientId = resolved.clientId;
      poUploadState.clientName = resolved.clientName;
      updatePoSaveClientHint();
    });
  }

  document.getElementById("po-btn-quick-client")?.addEventListener("click", () => {
    openAddClientModal(poUploadState.channelId, ({ name, channelId, clientId }) => {
      poUploadState.channelId = channelId;
      poUploadState.clientId = clientId || "";
      poUploadState.clientName = name;
      render();
    });
  });

  document.getElementById("po-date").addEventListener("change", (e) => {
    poUploadState.poDate = e.target.value;
  });
  document.getElementById("po-number").addEventListener("input", (e) => {
    poUploadState.poNumber = e.target.value;
  });

  const dropzone = document.getElementById("po-dropzone");
  const fileInput = document.getElementById("po-file-input");
  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      const file = e.dataTransfer.files?.[0];
      if (file) handlePoFile(file);
    });
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handlePoFile(file);
    });
  }

  document.querySelectorAll("[data-po-field]").forEach((el) => {
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, (e) => {
      const idx = parseInt(e.target.dataset.rowIndex, 10);
      const field = e.target.dataset.poField;
      const row = poUploadState.rows[idx];
      if (!row) return;
      if (field === "qty" || field === "unitPrice" || field === "amount") {
        row[field] = parseOptionalNumber(e.target.value);
        updatePoTotals();
        return;
      }
      if (field === "matchedCode") {
        row.matchedCode = e.target.value || null;
        const product = getProducts(appData).find((p) => p.code === row.matchedCode);
        row.matchedName = product ? product.nameKor : null;
        render();
        return;
      }
      row[field] = e.target.value;
    });
  });

  document.querySelectorAll("[data-po-remove-row]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.poRemoveRow, 10);
      poUploadState.rows.splice(idx, 1);
      render();
    });
  });

  document.getElementById("po-btn-add-row")?.addEventListener("click", () => {
    poUploadState.rows.push(emptyPoRow());
    render();
  });

  document.getElementById("po-btn-save")?.addEventListener("click", savePoUpload);
}

function parseProductForm(fd) {
  return {
    code: fd.get("code").trim(),
    category: fd.get("category").trim(),
    nameKor: fd.get("nameKor").trim(),
    nameEng: fd.get("nameEng").trim(),
    barcode: fd.get("barcode").trim() || "",
    size: fd.get("size").trim() || "",
    cartonQty: Number(fd.get("cartonQty")) || 50,
    cartonSize: fd.get("cartonSize").trim() || "",
    cbm: Number(fd.get("cbm")) || 0,
    shelfLife: Number(fd.get("shelfLife")) || 24,
    srpKrw: parseOptionalNumber(fd.get("srpKrw")),
    srpUsd: parseOptionalNumber(fd.get("srpUsd")),
    fobUsd: parseOptionalNumber(fd.get("fobUsd")),
    fobRate:
      parseOptionalNumber(fd.get("fobRate")) != null
        ? parseOptionalNumber(fd.get("fobRate")) / 100
        : null,
    moq: Number(fd.get("moq")) || 50,
  };
}

function syncProposalItemFromProduct(product) {
  if (!proposalState.items[product.code]) {
    proposalState.items[product.code] = { srpKrw: null, srpUsd: null, poQty: 0 };
  }
  proposalState.items[product.code].srpKrw = product.srpKrw ?? null;
  proposalState.items[product.code].srpUsd = product.srpUsd ?? null;
}

function renderProductForm(editProduct = null) {
  const isEdit = Boolean(editProduct);
  const p = editProduct || {};
  return `
    <div class="card no-print">
      <div class="card-title">${isEdit ? `제품 수정 — ${p.code}` : "신규 제품 추가"}</div>
      <div class="card-desc">${isEdit ? "변경 내용을 저장하면 단가표·발주서 기준 가격에도 반영됩니다." : "기준 소비자가를 입력해 두면 단가표 작성 시 자동으로 채워집니다."}</div>
      <form id="add-product-form" class="product-form">
        <div class="form-grid">
          <div class="form-group">
            <label>제품코드 *</label>
            <input type="text" name="code" placeholder="Br-0015" required
              value="${escapeAttr(p.code || "")}" ${isEdit ? "readonly class=\"input-readonly\"" : ""}>
          </div>
          <div class="form-group">
            <label>카테고리 *</label>
            <input type="text" name="category" placeholder="Serum" required value="${escapeAttr(p.category || "")}">
          </div>
          <div class="form-group">
            <label>제품명 (KOR) *</label>
            <input type="text" name="nameKor" placeholder="바를 ..." required value="${escapeAttr(p.nameKor || "")}">
          </div>
          <div class="form-group">
            <label>제품명 (ENG) *</label>
            <input type="text" name="nameEng" placeholder="Barle ..." required value="${escapeAttr(p.nameEng || "")}">
          </div>
          <div class="form-group">
            <label>바코드</label>
            <input type="text" name="barcode" placeholder="8800259230xxx" value="${escapeAttr(p.barcode || "")}">
          </div>
          <div class="form-group">
            <label>용량</label>
            <input type="text" name="size" placeholder="50ml" value="${escapeAttr(p.size || "")}">
          </div>
          <div class="form-group">
            <label>박스입수량</label>
            <input type="number" name="cartonQty" value="${p.cartonQty ?? 50}" min="1">
          </div>
          <div class="form-group">
            <label>카톤박스 사이즈</label>
            <input type="text" name="cartonSize" placeholder="46.5*24.2*19.5" value="${escapeAttr(p.cartonSize || "")}">
          </div>
          <div class="form-group">
            <label>CBM</label>
            <input type="number" name="cbm" step="0.00001" value="${p.cbm ?? 0.02}" min="0">
          </div>
          <div class="form-group">
            <label>유통기한 (개월)</label>
            <input type="number" name="shelfLife" value="${p.shelfLife ?? 24}" min="1">
          </div>
          <div class="form-group">
            <label>기준 소비자가 (₩)</label>
            <input type="number" name="srpKrw" step="1" min="0" placeholder="39000"
              value="${p.srpKrw ?? ""}">
          </div>
          <div class="form-group">
            <label>기준 소비자가 ($)</label>
            <input type="number" name="srpUsd" step="0.01" min="0" placeholder="29.59"
              value="${p.srpUsd ?? ""}">
          </div>
          <div class="form-group">
            <label>공급가 FOB ($)</label>
            <input type="number" name="fobUsd" step="0.0001" min="0" placeholder="8.5811"
              value="${p.fobUsd ?? ""}">
          </div>
          <div class="form-group">
            <label>공급가율 (%)</label>
            <input type="number" name="fobRate" value="${p.fobRate != null ? Math.round(p.fobRate * 1000) / 10 : 29}" min="1" max="100" step="0.1">
          </div>
          <div class="form-group">
            <label>MOQ (CTN)</label>
            <input type="number" name="moq" value="${p.moq ?? 50}" min="1">
          </div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn btn-primary btn-lg">${isEdit ? "💾 저장" : "+ 제품 추가"}</button>
          ${isEdit ? `<button type="button" class="btn btn-secondary btn-lg" id="btn-cancel-edit-product">취소</button>` : ""}
        </div>
      </form>
    </div>`;
}

function renderProducts() {
  const products = getProducts(appData);
  const editing = productEditCode
    ? products.find((p) => p.code === productEditCode)
    : null;

  return `
    <div class="help-box no-print">
      <span class="help-icon">📦</span>
      <div>
        <strong>제품 등록 = 기준 가격</strong> · 여기 입력한 소비자가·FOB가 단가표·발주서 작성 시 자동으로 채워집니다.<br>
        목록에서 <strong>수정</strong>을 눌러 내용을 변경할 수 있습니다.
      </div>
    </div>
    ${renderProductForm(editing)}
    <div class="card">
      <div class="card-title">등록된 제품 목록 (${products.length}개)</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>카테고리</th>
              <th>제품코드</th>
              <th>제품명 (KOR)</th>
              <th>제품명 (ENG)</th>
              <th>바코드</th>
              <th>용량</th>
              <th>박스입수량</th>
              <th>CBM</th>
              <th>유통기한</th>
              <th>기준가(₩)</th>
              <th>기준가($)</th>
              <th>FOB($)</th>
              <th>MOQ</th>
              <th class="no-print"></th>
            </tr>
          </thead>
          <tbody>
            ${products
              .map(
                (p) => `
              <tr class="${productEditCode === p.code ? "row-editing" : ""}">
                <td>${p.category}</td>
                <td><code>${p.code}</code></td>
                <td>${p.nameKor}</td>
                <td style="font-size:12px;color:var(--text-muted)">${p.nameEng}</td>
                <td style="font-size:12px">${p.barcode || "—"}</td>
                <td>${p.size || "—"}</td>
                <td>${p.cartonQty}</td>
                <td>${p.cbm}</td>
                <td>${p.shelfLife}개월</td>
                <td>${p.srpKrw != null ? formatKrw(p.srpKrw) : "—"}</td>
                <td>${p.srpUsd != null ? formatUsd(p.srpUsd) : "—"}</td>
                <td>${p.fobUsd != null ? formatUsd(p.fobUsd) : "—"}</td>
                <td>${p.moq}</td>
                <td class="no-print">
                  <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="btn btn-secondary btn-sm" data-edit-product="${p.code}">수정</button>
                    <button class="btn btn-danger btn-sm" data-delete-code="${p.code}">삭제</button>
                  </div>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function bindProductEvents() {
  const form = document.getElementById("add-product-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const product = parseProductForm(fd);

      if (productEditCode) {
        const result = updateProduct(appData, productEditCode, product);
        if (!result.ok) {
          showToast(result.error);
          return;
        }
        syncProposalItemFromProduct(result.product);
        showToast(`제품 ${productEditCode} 수정됨`);
        productEditCode = null;
        render();
        return;
      }

      const result = addProduct(appData, product);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      syncProposalItemFromProduct(product);
      showToast(`제품 ${product.code} 추가됨`);
      form.reset();
      render();
    });
  }

  document.getElementById("btn-cancel-edit-product")?.addEventListener("click", () => {
    productEditCode = null;
    render();
  });

  document.querySelectorAll("[data-edit-product]").forEach((btn) => {
    btn.addEventListener("click", () => {
      productEditCode = btn.dataset.editProduct;
      render();
      document.getElementById("add-product-form")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  document.querySelectorAll("[data-delete-code]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.deleteCode;
      if (!(await confirmDelete("제품 삭제", `제품코드: ${code}`))) return;
      const result = deleteProduct(appData, code);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      if (productEditCode === code) productEditCode = null;
      delete proposalState.items[code];
      showToast(`제품 ${code} 삭제됨`);
      render();
    });
  });
}

function openMaster(channelId) {
  if (channelId) {
    masterChannelId = channelId;
    masterNewChannel = false;
    masterEditClientId = null;
  }
  setView("master");
}

function renderMaster() {
  const channels = getChannelList();
  if (!channels.some((c) => c.id === masterChannelId)) {
    masterChannelId = channels[0]?.id || "";
  }

  return `
    <div class="help-box no-print">
      <span class="help-icon">🌐</span>
      <div>왼쪽에서 <strong>판매 국가</strong>를 선택하면 국가 정보·거래 업체·거래 조건을 한 번에 관리할 수 있습니다.
        단가표·발주서 화면에서도 등록된 업체를 바로 선택할 수 있습니다.</div>
    </div>
    <div class="master-layout no-print">
      <aside class="card master-sidebar">
        <div class="card-title">판매 국가</div>
        <ul class="master-channel-list">
          ${channels
            .map((ch) => {
              const clientCount = getClients(appData, ch.id).length;
              const active = ch.id === masterChannelId && !masterNewChannel;
              return `
            <li>
              <button type="button" class="master-channel-item${active ? " active" : ""}" data-select-channel="${ch.id}">
                <span class="master-channel-name">${channelBadge(ch.id)} ${ch.name}</span>
                <span class="master-channel-meta">${ch.currency} · 업체 ${clientCount}개</span>
              </button>
            </li>`;
            })
            .join("")}
        </ul>
        <button type="button" class="btn btn-secondary btn-sm master-new-btn" id="btn-master-new-channel">+ 신규 국가</button>
      </aside>
      <div class="master-detail">
        ${masterNewChannel ? renderMasterNewChannel() : renderMasterChannelDetail(masterChannelId)}
      </div>
    </div>
  `;
}

function renderMasterNewChannel() {
  return `
    <div class="card">
      <div class="card-title">신규 판매 국가 등록</div>
      <p class="card-desc">판매국가명만 입력하면 됩니다. 등록 후 같은 화면에서 업체와 거래 조건을 바로 추가할 수 있습니다.</p>
      <form id="master-new-channel-form">
        <div class="form-grid form-grid-2">
          <div class="form-group form-grid-full">
            <label>판매국가명 *</label>
            <input type="text" name="name" placeholder="예: Ulta Beauty, 오프라인" required autofocus>
          </div>
          <div class="form-group">
            <label>통화 *</label>
            <select name="currency" required>
              <option value="USD">USD ($) — 해외</option>
              <option value="KRW">KRW (₩) — 국내</option>
            </select>
          </div>
          <div class="form-group">
            <label>기본 FOB 비율 (%) *</label>
            <input type="number" name="defaultFobRate" value="30" min="1" max="100" step="0.1" required>
          </div>
        </div>
        <div class="master-form-actions">
          <button type="submit" class="btn btn-primary btn-lg">국가 등록</button>
          <button type="button" class="btn btn-secondary btn-lg" id="btn-master-cancel-new">취소</button>
        </div>
      </form>
    </div>
  `;
}

function renderMasterChannelDetail(channelId) {
  const channel = getChannelList().find((c) => c.id === channelId);
  if (!channel) {
    return `<div class="card"><div class="empty-state"><div class="empty-icon">🌐</div>판매국가를 선택하거나 신규 국가를 추가해주세요.</div></div>`;
  }

  const usage = getChannelUsage(appData, channelId);
  const clients = getClients(appData, channelId);
  const terms = getChannelTerms(appData, channelId);
  const editingClient = masterEditClientId
    ? clients.find((c) => c.id === masterEditClientId)
    : null;
  const canDeleteChannel = usage.clients === 0 && usage.proposals === 0;

  return `
    <div class="card">
      <div class="card-title">① 국가 기본 정보</div>
      <form id="master-channel-form">
        <div class="form-grid form-grid-2">
          <div class="form-group form-grid-full">
            <label>판매국가명 *</label>
            <input type="text" name="name" value="${escapeAttr(channel.name)}" required>
          </div>
          <div class="form-group">
            <label>통화 *</label>
            <select name="currency" required>
              <option value="USD" ${channel.currency === "USD" ? "selected" : ""}>USD ($) — 해외</option>
              <option value="KRW" ${channel.currency === "KRW" ? "selected" : ""}>KRW (₩) — 국내</option>
            </select>
          </div>
          <div class="form-group">
            <label>기본 FOB 비율 (%) *</label>
            <input type="number" name="defaultFobRate" value="${Math.round(channel.defaultFobRate * 100)}" min="1" max="100" step="0.1" required>
          </div>
        </div>
        <div class="master-form-actions">
          <button type="submit" class="btn btn-primary">국가 정보 저장</button>
          ${
            canDeleteChannel
              ? `<button type="button" class="btn btn-danger" data-delete-channel="${channel.id}" data-channel-name="${escapeAttr(channel.name)}" data-client-count="0" data-proposal-count="0">국가 삭제</button>`
              : `<span class="field-hint">업체 ${usage.clients}개 · 단가표 ${usage.proposals}건 연결 — 삭제 불가</span>`
          }
        </div>
      </form>
    </div>

    <div class="card">
      <div class="card-title">② 거래 업체 (${clients.length}개)</div>
      <form id="master-client-form" class="master-client-form">
        ${editingClient ? `<input type="hidden" name="clientId" value="${editingClient.id}">` : ""}
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label>업체명 *</label>
            <input type="text" name="name" placeholder="예: 올리브영 본사, OO무역" value="${escapeAttr(editingClient?.name || "")}" required>
          </div>
          <div class="form-group">
            <label>담당자 / 연락처</label>
            <input type="text" name="contact" placeholder="홍길동 / 010-0000-0000" value="${escapeAttr(editingClient?.contact || "")}">
          </div>
          <div class="form-group form-grid-full">
            <label>메모</label>
            <input type="text" name="memo" placeholder="비고 사항" value="${escapeAttr(editingClient?.memo || "")}">
          </div>
        </div>
        <div class="master-form-actions">
          <button type="submit" class="btn btn-primary">${editingClient ? "업체 수정" : "+ 업체 추가"}</button>
          ${editingClient ? `<button type="button" class="btn btn-secondary" id="btn-cancel-edit-client">취소</button>` : ""}
        </div>
      </form>
      ${
        clients.length === 0
          ? `<div class="empty-state compact"><div class="empty-icon">🏢</div>등록된 업체가 없습니다. 위 양식에서 추가해주세요.</div>`
          : `
      <div class="table-wrap" style="margin-top:16px">
        <table>
          <thead>
            <tr>
              <th>업체명</th>
              <th>담당자/연락처</th>
              <th>메모</th>
              <th>단가표</th>
              <th>발주</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${clients
              .map((c) => {
                const quoteCount = getClientProposalCount(appData, c);
                const orderCount = getClientOrderCount(appData, c);
                return `
              <tr class="${c.id === masterEditClientId ? "row-editing" : ""}">
                <td><strong>${c.name}</strong></td>
                <td>${c.contact || "—"}</td>
                <td style="font-size:13px;color:var(--text-muted)">${c.memo || "—"}</td>
                <td>${quoteCount > 0 ? `<span class="count-badge">${quoteCount}건</span>` : "—"}</td>
                <td>${orderCount > 0 ? `<span class="count-badge">${orderCount}건</span>` : "—"}</td>
                <td class="master-row-actions">
                  <button type="button" class="btn btn-secondary btn-sm" data-edit-client="${c.id}">수정</button>
                  <button type="button" class="btn btn-danger btn-sm" data-delete-client="${c.id}" data-client-name="${escapeAttr(c.name)}" data-proposal-count="${quoteCount}">삭제</button>
                </td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`
      }
    </div>

    <div class="card">
      <div class="card-title">③ 거래 조건 (T&C) — ${channel.name}</div>
      <p class="card-desc">한 줄에 한 항목씩 작성하세요. 저장하면 이후 단가표·발주서에 반영됩니다.</p>
      <form id="master-terms-form">
        <div class="form-group">
          <textarea id="master-terms-editor" class="terms-editor" rows="10" placeholder="1. 납품 조건 : ...&#10;2. 결제 조건 : ...">${terms.join("\n")}</textarea>
        </div>
        <div class="master-form-actions">
          <button type="submit" class="btn btn-primary">거래 조건 저장</button>
          <button type="button" class="btn btn-secondary" id="btn-master-reset-terms">기본값 복원</button>
          <button type="button" class="btn btn-danger" id="btn-master-clear-terms">전체 삭제</button>
        </div>
      </form>
      <div class="terms-box master-terms-preview">
        <h4>미리보기</h4>
        ${terms.length ? terms.map((t) => `<p>${t}</p>`).join("") : "<p class='text-muted'>등록된 거래 조건이 없습니다.</p>"}
      </div>
    </div>
  `;
}

function bindMasterEvents() {
  try {
    document.querySelectorAll("[data-select-channel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      masterChannelId = btn.dataset.selectChannel;
      masterNewChannel = false;
      masterEditClientId = null;
      termsChannelId = masterChannelId;
      render();
    });
  });

  document.getElementById("btn-master-new-channel")?.addEventListener("click", () => {
    masterNewChannel = true;
    masterEditClientId = null;
    render();
  });

  document.getElementById("btn-master-cancel-new")?.addEventListener("click", () => {
    masterNewChannel = false;
    render();
  });

  document.getElementById("master-new-channel-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const result = addChannel(appData, {
      name: fd.get("name"),
      currency: fd.get("currency"),
      defaultFobRate: fd.get("defaultFobRate"),
    });
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    const newId = result.id;
    masterChannelId = newId;
    masterNewChannel = false;
    termsChannelId = newId;
    showToast("판매국가가 등록되었습니다. 업체와 거래 조건을 추가해주세요.");
    render();
  });

  document.getElementById("master-channel-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const result = updateChannel(appData, masterChannelId, {
      name: fd.get("name"),
      currency: fd.get("currency"),
      defaultFobRate: fd.get("defaultFobRate"),
    });
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    if (proposalState.channelId === masterChannelId) {
      proposalState.fobRate = Math.round(findChannel(masterChannelId).defaultFobRate * 100);
    }
    showToast("국가 정보가 저장되었습니다");
    render();
  });

  document.getElementById("master-client-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const clientId = fd.get("clientId")?.toString();
    const payload = {
      channelId: masterChannelId,
      name: fd.get("name"),
      contact: fd.get("contact"),
      memo: fd.get("memo"),
    };
    const result = clientId
      ? updateClient(appData, clientId, payload)
      : addClient(appData, payload);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    showToast(clientId ? "업체 정보가 수정되었습니다" : "업체가 등록되었습니다");
    masterEditClientId = null;
    render();
  });

  document.getElementById("btn-cancel-edit-client")?.addEventListener("click", () => {
    masterEditClientId = null;
    render();
  });

  document.querySelectorAll("[data-edit-client]").forEach((btn) => {
    btn.addEventListener("click", () => {
      masterEditClientId = btn.dataset.editClient;
      render();
    });
  });

  document.getElementById("master-terms-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = document.getElementById("master-terms-editor")?.value || "";
    const terms = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    setChannelTerms(appData, masterChannelId, terms);
    termsChannelId = masterChannelId;
    showToast("거래 조건이 저장되었습니다");
    render();
  });

  document.getElementById("btn-master-reset-terms")?.addEventListener("click", async () => {
    const channel = findChannel(masterChannelId);
    if (!(await confirmRestore("거래 조건 복원", `판매국가: ${channel.name}`))) return;
    setChannelTerms(appData, masterChannelId, getDefaultChannelTerms(appData, masterChannelId));
    showToast("기본값으로 복원되었습니다");
    render();
  });

  document.getElementById("btn-master-clear-terms")?.addEventListener("click", async () => {
    const channel = findChannel(masterChannelId);
    if (!(await confirmDelete("거래 조건 삭제", `판매국가: ${channel.name}\n※ 모든 거래 조건 항목이 삭제됩니다`))) return;
    clearChannelTerms(appData, masterChannelId);
    showToast("거래 조건이 삭제되었습니다");
    render();
  });

  bindMasterDeleteHandlers();
  } catch (err) {
    console.error("bindMasterEvents error:", err);
    showToast("일부 버튼 연결 오류 — 새로고침 해주세요");
  }
}

function bindMasterDeleteHandlers() {
  document.querySelectorAll("[data-delete-channel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const channelId = btn.dataset.deleteChannel;
      const name = btn.dataset.channelName;
      if (!(await confirmDelete("국가 삭제", `판매국가: ${name}`))) return;
      const result = deleteChannel(appData, channelId);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      if (proposalState.channelId === channelId) {
        initProposalState(getChannelList()[0]?.id);
      }
      masterChannelId = getChannelList()[0]?.id || "";
      termsChannelId = masterChannelId;
      showToast(`판매국가 "${name}" 삭제됨`);
      render();
    });
  });

  document.querySelectorAll("[data-delete-client]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deleteClient;
      const name = btn.dataset.clientName;
      const count = parseInt(btn.dataset.proposalCount, 10);
      const detail = [`업체명: ${name}`];
      if (count > 0) detail.push(`※ 단가표 이력 ${count}건은 유지됩니다`);
      if (!(await confirmDelete("업체 삭제", detail.join("\n")))) return;
      const result = deleteClient(appData, id);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      if (masterEditClientId === id) masterEditClientId = null;
      if (proposalState.clientId === id || proposalState.clientName === name) {
        proposalState.clientId = "";
        proposalState.clientName = "";
      }
      showToast(`업체 "${name}" 삭제됨`);
      render();
    });
  });
}

function renderHistory() {
  const filterChannel = historyFilter;
  const proposals = getQuotes(appData, filterChannel || null);

  if (proposals.length === 0) {
    return `
      <div class="form-row no-print">
        <div class="form-group">
          <label>국가 필터</label>
          <select id="history-filter">
            <option value="">전체</option>
            ${getChannelList().map((ch) => `<option value="${ch.id}">${ch.name}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="card">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          저장된 단가표가 없습니다.<br>
          <button class="btn btn-primary" style="margin-top:16px" onclick="setView('proposal')">단가표 만들기 →</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="form-row no-print">
      <div class="form-group">
        <label>국가 필터</label>
        <select id="history-filter">
          <option value="">전체</option>
          ${getChannelList().map(
            (ch) =>
              `<option value="${ch.id}" ${filterChannel === ch.id ? "selected" : ""}>${ch.name}</option>`
          ).join("")}
        </select>
      </div>
    </div>
    <div class="card">
      <div class="card-title">저장된 단가표 (${proposals.length}건)</div>
      ${proposals
        .map((p) => {
          const ch = getChannelList().find((c) => c.id === p.channelId);
          return `
          <div class="history-item">
            <div class="history-meta">
              ${channelBadge(p.channelId)}
              <span class="version">v${p.version}</span>
              <span>${p.clientName}</span>
              <span class="date">${p.poDate} · FOB ${p.fobRate}%</span>
              <span class="date">Total: ${formatMoney(p.totalAmount, ch)}</span>
            </div>
            <div class="history-actions no-print">
              <button class="btn btn-secondary btn-sm" data-view-id="${p.id}">보기</button>
              <button class="btn btn-secondary btn-sm" data-pdf-id="${p.id}">📄 PDF</button>
              <button class="btn btn-primary btn-sm" data-excel-id="${p.id}">📥 엑셀</button>
              <button class="btn btn-danger btn-sm" data-delete-proposal="${p.id}">삭제</button>
            </div>
          </div>`;
        })
        .join("")}
    </div>
    <div id="history-detail"></div>
  `;
}

function bindHistoryEvents() {
  const filter = document.getElementById("history-filter");
  if (filter) {
    filter.addEventListener("change", (e) => {
      historyFilter = e.target.value;
      render();
    });
  }
  document.querySelectorAll("[data-view-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const proposal = getProposalById(appData, e.target.dataset.viewId);
      if (!proposal) return;
      const ch = getChannelList().find((c) => c.id === proposal.channelId);
      const detail = document.getElementById("history-detail");
      detail.innerHTML = `
        <div class="card proposal-history-detail" style="margin-top:20px">
          <div class="proposal-history-detail-header no-print">
            <div class="card-title" style="margin:0">v${proposal.version} — ${proposal.clientName} (${ch?.name || proposal.channelId}) · ${proposal.poDate}</div>
            <div class="proposal-history-detail-actions">
              <button class="btn btn-secondary" data-pdf-id="${proposal.id}">📄 PDF 저장</button>
              <button class="btn btn-primary" data-excel-id="${proposal.id}">📥 엑셀 다운로드</button>
              <button class="btn btn-danger" data-delete-proposal="${proposal.id}">삭제</button>
            </div>
          </div>
          <div class="proposal-doc-preview">
            ${buildProposalDocumentHtml(proposal)}
          </div>
        </div>
      `;
      detail.scrollIntoView({ behavior: "smooth" });
    });
  });
}

function getOtherOrderMonths(currentMonth) {
  const months = new Set();
  getOrders(appData).forEach((p) => {
    const d = getProposalDate(p);
    if (d) months.add(d.slice(0, 7));
  });
  return [...months]
    .filter((m) => m !== currentMonth)
    .sort()
    .reverse()
    .map((m) => {
      const [y, mo] = m.split("-");
      return { value: m, label: `${y}년 ${parseInt(mo)}월` };
    });
}

function renderSales() {
  const summary = buildSalesSummary(appData, salesMonth);
  const [year, month] = salesMonth.split("-");
  const monthLabel = `${year}년 ${parseInt(month)}월`;
  const otherMonths = getOtherOrderMonths(salesMonth);
  const otherMonthsHint = otherMonths.length
    ? `<p class="field-hint" style="margin-top:8px">다른 달 발주: ${otherMonths
        .map((m) => `<button type="button" class="link-btn" data-jump-sales-month="${m.value}">${m.label}</button>`)
        .join(" · ")}</p>`
    : "";

  const channelCards = summary.byChannel
    .map((ch) => {
      const amountStr = formatDualCurrencyTotalsHtml(ch.totalKrw, ch.totalUsd, ch.totalJpy);
      const isSelected = salesChannelId === ch.channelId;
      return `
        <button type="button" class="channel-summary-card ${ch.count > 0 ? "active" : ""} ${isSelected ? "selected" : ""}"
          data-sales-channel="${ch.channelId}" ${ch.count === 0 ? "disabled" : ""}>
          <div class="channel-summary-header">
            ${channelBadge(ch.channelId)}
            <strong>${ch.channelName}</strong>
          </div>
          <div class="channel-summary-stats">
            <div>
              <span class="big-num">${ch.count}</span>
              <span class="unit">건</span>
            </div>
            <div class="channel-summary-amount">${amountStr}</div>
          </div>
          <div class="channel-summary-sub">
            ${ch.count > 0 ? `업체 ${ch.clients.length}곳 · 클릭하여 상세 보기` : "이번 달 발주 없음"}
          </div>
        </button>`;
    })
    .join("");

  if (summary.totalCount === 0) {
    return `
      <div class="form-row no-print">
        <div class="form-group">
          <label>조회 월</label>
          <input type="month" id="sales-month" value="${salesMonth}">
        </div>
      </div>
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
        ${channelCards}
      </div>
      <div class="card">
        <div class="empty-state">
          <div class="empty-icon">📈</div>
          ${monthLabel}에 등록된 발주서가 없습니다.<br>
          ${otherMonthsHint}
          <button class="btn btn-primary" style="margin-top:16px" onclick="setView('poupload')">발주서 등록 →</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="help-box no-print">
      <span class="help-icon">📈</span>
      <div>
        <strong>${monthLabel}</strong> 기준 <strong>실제 발주(매출)</strong> 현황입니다.
        위 <strong>판매국가</strong>를 클릭하면 업체별 발주 상세를 볼 수 있습니다. 업체명이 잘못되면 상세에서 수정할 수 있습니다.
        ${otherMonthsHint}
      </div>
    </div>

    <div class="form-row no-print">
      <div class="form-group">
        <label>조회 월</label>
        <input type="month" id="sales-month" value="${salesMonth}">
      </div>
      <div style="margin-left:auto;display:flex;gap:10px;align-items:flex-end">
        <button class="btn btn-primary" id="btn-export-sales">📥 ${monthLabel} 영업현황 엑셀</button>
      </div>
    </div>

    <div class="stats-grid sales-channel-grid" style="margin-bottom:24px">
      ${channelCards}
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="highlight-stat">
        <span class="highlight-label">${monthLabel} 전체 발주</span>
        <span class="highlight-value">${summary.totalCount}<small>건</small></span>
      </div>
      <div class="highlight-totals">${formatDualCurrencyTotalsHtml(summary.totalKrw, summary.totalUsd, summary.totalJpy)}</div>
    </div>

    ${salesChannelId ? renderSalesChannelDetail(salesChannelId, summary, monthLabel) : ""}
  `;
}

function bindSalesEvents() {
  document.getElementById("sales-month")?.addEventListener("change", (e) => {
    salesMonth = e.target.value;
    salesChannelId = "";
    render();
  });

  document.getElementById("btn-export-sales")?.addEventListener("click", () => {
    const summary = buildSalesSummary(appData, salesMonth);
    exportSalesSummaryToExcel(summary, salesMonth);
    showToast("영업현황 엑셀 다운로드 중...");
  });

  document.querySelectorAll("[data-sales-channel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const channelId = btn.dataset.salesChannel;
      salesChannelId = salesChannelId === channelId ? "" : channelId;
      render();
      if (salesChannelId) {
        document.querySelector(".sales-channel-detail")?.scrollIntoView({ behavior: "smooth" });
      }
    });
  });

  document.querySelectorAll("[data-jump-sales-month]").forEach((btn) => {
    btn.addEventListener("click", () => {
      salesMonth = btn.dataset.jumpSalesMonth;
      salesChannelId = "";
      render();
    });
  });

  document.querySelectorAll("[data-view-proposal]").forEach((b) => {
    b.addEventListener("click", () => {
      const proposal = getProposalById(appData, b.dataset.viewProposal);
      if (!proposal) return;
      if (getRecordType(proposal) === "quote") {
        historyFilter = proposal.channelId;
        setView("history");
        setTimeout(() => {
          document.querySelector(`[data-view-id="${b.dataset.viewProposal}"]`)?.click();
        }, 100);
        return;
      }
      const ch = getChannelList().find((c) => c.id === proposal.channelId);
      const detail = document.getElementById("sales-proposal-detail");
      if (!detail) return;
      detail.innerHTML = `
        <div class="card" style="margin-top:20px">
          <div class="card-title">발주 상세 — ${proposal.clientName} · ${proposal.poDate}</div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>제품코드</th><th>제품명</th><th>발주수량</th><th>단가</th><th>금액</th></tr>
              </thead>
              <tbody>
                ${proposal.items
                  .map(
                    (item) => `
                  <tr>
                    <td><code>${item.productCode}</code></td>
                    <td>${item.nameKor}</td>
                    <td>${item.poQty}</td>
                    <td>${formatProposalUnitPrice(item, proposal, ch)}</td>
                    <td>${formatProposalMoney(item.amount, proposal, ch)}</td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="4" style="text-align:right;font-weight:700">Total</td>
                  <td class="total-row">${formatProposalMoney(proposal.totalAmount, proposal, ch)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>`;
      detail.scrollIntoView({ behavior: "smooth" });
    });
  });
}

function setupSidebarNav() {
  const nav = document.querySelector(".sidebar-nav");
  if (!nav || nav.dataset.bound) return;
  nav.dataset.bound = "1";
  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-item[data-view]");
    if (!btn?.dataset.view) return;
    e.preventDefault();
    setView(btn.dataset.view);
  });
}

function openProposal(channelId) {
  initProposalState(channelId);
  setView("proposal");
}

function setupAppNavigation() {
  document.getElementById("btn-nav-back")?.addEventListener("click", goBack);
  document.getElementById("btn-nav-home")?.addEventListener("click", goHome);

  const sidebarHome = document.getElementById("btn-sidebar-home");
  sidebarHome?.addEventListener("click", goHome);
  sidebarHome?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      goHome();
    }
  });

  window.addEventListener("popstate", (e) => {
    const view = e.state?.view || parseViewFromHash();
    setView(view, { skipHistory: true });
  });
}

function bootApp() {
  const versionEl = document.getElementById("app-version-label");
  if (versionEl) versionEl.textContent = "버전 " + window.APP_BUILD;

  initProposalState("CN");
  setupGlobalDeleteHandlers();
  setupClientModal();
  setupSidebarNav();
  setupAppNavigation();

  const initialView = parseViewFromHash();
  history.replaceState({ view: initialView }, "", `#${initialView}`);
  setView(initialView, { skipHistory: true });

  document.getElementById("menu-toggle")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebar-overlay").classList.toggle("open");
  });

  document.getElementById("sidebar-overlay")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("open");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootApp);
} else {
  bootApp();
}

window.setView = setView;
window.goBack = goBack;
window.goHome = goHome;
window.openMaster = openMaster;
window.openProposal = openProposal;

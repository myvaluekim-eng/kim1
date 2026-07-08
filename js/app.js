let appData = loadData();
let currentView = "dashboard";
let historyFilter = "";
let clientFilter = "";
let salesMonth = new Date().toISOString().slice(0, 7);
let termsChannelId = "CN";
let proposalState = {
  channelId: "CN",
  clientName: "",
  poDate: new Date().toISOString().slice(0, 10),
  fobRate: 29,
  exchangeRate: DEFAULT_EXCHANGE_RATE,
  items: {},
};

let quickClientCallback = null;

function freshPoUploadState() {
  return {
    channelId: "CN",
    clientName: "",
    poDate: new Date().toISOString().slice(0, 10),
    poNumber: "",
    fileName: "",
    fileKind: "",
    rows: [],
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
    const srp = getChannelSrp(appData, p.code, channel.id);
    proposalState.items[p.code] = {
      srpKrw: srp.krw,
      srpUsd: srp.usd,
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

function formatUsd(value) {
  if (value == null) return "—";
  return "$" + value.toFixed(2);
}

function formatMoney(value, channel) {
  if (value == null) return "—";
  if (channel.currency === "KRW") return formatKrw(value);
  return formatUsd(value);
}

function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function channelBadge(channelId) {
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
          "단가표 삭제",
          `업체: ${proposal.clientName}\n채널: ${ch?.name}\n버전: v${proposal.version}\n작성일: ${proposal.poDate}`
        ))
      ) {
        return;
      }
      const result = deleteProposal(appData, id);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      showToast("단가표가 삭제되었습니다");
      render();
    }
  });
}

const PAGE_META = {
  dashboard: { title: "시작하기", desc: "무엇을 하실지 선택하세요. 처음이시면 아래 순서를 따라하시면 됩니다." },
  proposal: { title: "단가표 만들기", desc: "① 채널·업체 입력 → ② 가격 확인 → ③ 저장 버튼 클릭" },
  poupload: { title: "발주서 등록", desc: "발주서 파일(엑셀) 또는 이미지를 올리면 자동으로 인식해 영업 현황에 반영합니다." },
  products: { title: "제품 등록", desc: "새로 출시된 제품을 등록하거나 기존 제품을 관리합니다." },
  channels: { title: "판매채널 등록", desc: "판매 채널을 추가하거나 삭제합니다. 채널별 통화·FOB 비율이 단가표에 반영됩니다." },
  clients: { title: "업체 등록", desc: "거래처(업체)를 등록하거나 삭제합니다. 단가표 작성 화면에서도 바로 등록할 수 있습니다." },
  srp: { title: "소비자가 설정", desc: "채널별 권장 소비자가를 미리 입력해 두면 단가표에 자동으로 채워집니다." },
  history: { title: "지난 단가표", desc: "이전에 저장한 단가표를 다시 확인하거나 엑셀로 다운로드합니다." },
  sales: { title: "영업 현황", desc: "이번 달 업체별·채널별 발주 건수와 금액을 한눈에 확인합니다." },
  terms: { title: "거래 조건", desc: "채널별 거래 약관(T&C)을 수정합니다. 저장하면 단가표에 반영됩니다." },
};

function setView(view) {
  currentView = view;
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });
  const meta = PAGE_META[view];
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-desc").textContent = meta.desc;
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-overlay")?.classList.remove("open");
  render();
}

function render() {
  const content = document.getElementById("content");
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
    case "channels":
      content.innerHTML = renderChannels();
      bindChannelEvents();
      break;
    case "clients":
      content.innerHTML = renderClients();
      bindClientEvents();
      break;
    case "srp":
      content.innerHTML = renderSrpMatrix();
      bindSrpEvents();
      break;
    case "history":
      content.innerHTML = renderHistory();
      bindHistoryEvents();
      break;
    case "sales":
      content.innerHTML = renderSales();
      bindSalesEvents();
      break;
    case "terms":
      content.innerHTML = renderTerms();
      bindTermsEvents();
      break;
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

function refreshProposalClientSelect(clientName) {
  const clientSelect = document.getElementById("client-select");
  if (!clientSelect) return;
  clientSelect.innerHTML = getClientSelectOptions(proposalState.channelId, clientName);
  proposalState.clientName = clientName || "";
  if (clientName) clientSelect.value = clientName;
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
    if (callback) {
      callback({ name, channelId });
    } else if (currentView === "clients") {
      render();
    }
  });
}

function renderDashboard() {
  const products = getProducts(appData);
  const totalProposals = appData.proposals.length;
  const channels = getChannelList();
  const byChannel = channels.map((ch) => ({
    ...ch,
    count: appData.proposals.filter((p) => p.channelId === ch.id).length,
  }));

  return `
    <div class="action-grid no-print">
      <button class="action-card primary" onclick="setView('proposal')">
        <div class="action-icon">📋</div>
        <div class="action-title">단가표 만들기</div>
        <div class="action-desc">업체에 보낼 가격표를 작성하고 저장합니다</div>
      </button>
      <button class="action-card" onclick="setView('poupload')">
        <div class="action-icon">🧾</div>
        <div class="action-title">발주서 등록</div>
        <div class="action-desc">발주서 파일이나 이미지를 올리면 자동으로 인식합니다</div>
      </button>
      <button class="action-card" onclick="setView('history')">
        <div class="action-icon">🕐</div>
        <div class="action-title">지난 단가표 보기</div>
        <div class="action-desc">이전에 저장한 가격표를 다시 확인합니다</div>
      </button>
      <button class="action-card" onclick="setView('products')">
        <div class="action-icon">📦</div>
        <div class="action-title">제품 등록</div>
        <div class="action-desc">신규 제품을 추가합니다</div>
      </button>
      <button class="action-card" onclick="openAddClientModal('')">
        <div class="action-icon">🏢</div>
        <div class="action-title">업체 등록</div>
        <div class="action-desc">거래처를 바로 추가합니다</div>
      </button>
      <button class="action-card" onclick="setView('sales')">
        <div class="action-icon">📈</div>
        <div class="action-title">영업 현황</div>
        <div class="action-desc">이번 달 업체별·채널별 발주 확인</div>
      </button>
    </div>

    <div class="card no-print">
      <div class="card-title">처음 사용하시나요?</div>
      <div class="card-desc">아래 순서대로 진행하시면 됩니다.</div>
      <div class="steps-guide">
        <div class="step-item">
          <span class="step-num">1</span>
          <p><strong>채널·업체·제품 등록</strong>판매 채널과 거래처, 제품을 먼저 등록합니다</p>
        </div>
        <div class="step-item">
          <span class="step-num">2</span>
          <p><strong>소비자가 입력</strong>채널별 권장 소비자가를 설정합니다 (선택)</p>
        </div>
        <div class="step-item">
          <span class="step-num">3</span>
          <p><strong>단가표 작성</strong>업체 선택 후 저장합니다</p>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">등록된 제품</div>
        <div class="value">${products.length}<span style="font-size:16px">개</span></div>
      </div>
      <div class="stat-card">
        <div class="label">관리 채널</div>
        <div class="value">${channels.length}<span style="font-size:16px">개</span></div>
        <div class="sub">${channels.map((c) => c.name).join(" · ")}</div>
      </div>
      <div class="stat-card">
        <div class="label">저장된 단가표</div>
        <div class="value">${totalProposals}<span style="font-size:16px">건</span></div>
      </div>
      <div class="stat-card">
        <div class="label">최근 작성일</div>
        <div class="value" style="font-size:18px;padding-top:4px">
          ${appData.proposals[0] ? new Date(appData.proposals[0].createdAt).toLocaleDateString("ko-KR") : "—"}
        </div>
        <div class="sub">${appData.proposals[0]?.clientName || "아직 없음"}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">채널별 바로가기</div>
      <div class="card-desc">채널을 선택하면 단가표 작성 화면으로 이동합니다.</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>채널</th>
              <th>통화</th>
              <th>기본 FOB 비율</th>
              <th>저장된 단가표</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${byChannel
              .map(
                (ch) => `
              <tr>
                <td>${channelBadge(ch.id)} <strong>${ch.name}</strong></td>
                <td>${ch.currency}</td>
                <td>${Math.round(ch.defaultFobRate * 100)}%</td>
                <td>${ch.count}건</td>
                <td>
                  <button class="btn btn-primary btn-sm" onclick="openProposal('${ch.id}')">
                    단가표 만들기
                  </button>
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

function getClientSelectOptions(channelId, selectedName) {
  const clients = getClients(appData, channelId);
  const options = clients
    .map(
      (c) =>
        `<option value="${c.name}" ${c.name === selectedName ? "selected" : ""}>${c.name}</option>`
    )
    .join("");
  const isRegistered = selectedName && clients.some((c) => c.name === selectedName);
  const legacyOption =
    selectedName && !isRegistered
      ? `<option value="${selectedName}" selected>${selectedName}</option>`
      : "";
  return `
    <option value="">업체를 선택하세요</option>
    ${options}
    ${legacyOption}
  `;
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
        <p>Barle Cosmetics · ${channel.name} 채널</p>
      </div>
    </div>

    <div class="help-box no-print">
      <span class="help-icon">💡</span>
      <div>
        <strong>입력 방법</strong><br>
        노란 칸(소비자가, 주문수량)만 직접 입력하세요. 파란 칸(FOB, 금액)은 자동으로 계산됩니다.
      </div>
    </div>

    <div class="section-block no-print">
      <div class="section-label">① 기본 정보 입력</div>
      <div class="proposal-meta-panel">
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
              ${getClientSelectOptions(proposalState.channelId, proposalState.clientName)}
            </select>
            <button type="button" class="btn btn-secondary" id="btn-quick-client">+ 신규</button>
          </div>
          ${
            channelClients.length === 0
              ? `<span class="field-hint">등록된 업체가 없습니다. <strong>+ 신규</strong> 버튼으로 추가하세요.</span>`
              : ""
          }
        </div>
        <div class="form-group">
          <label>작성일</label>
          <input type="date" id="po-date" value="${proposalState.poDate}">
        </div>
        <div class="proposal-meta-actions">
          <button class="btn btn-secondary" id="btn-print">🖨 인쇄</button>
          <button class="btn btn-success btn-lg" id="btn-save">💾 저장하기</button>
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
        거래 조건을 바꾸려면 왼쪽 메뉴 <strong>설정 → 거래 조건</strong>에서 수정하세요.
      </p>
    </div>
  `;
}

function bindProposalEvents() {
  const channel = getChannelList().find((c) => c.id === proposalState.channelId);

  document.getElementById("channel-select").addEventListener("change", (e) => {
    initProposalState(e.target.value);
    proposalState.clientName = "";
    render();
  });

  const clientSelect = document.getElementById("client-select");

  if (clientSelect) {
    clientSelect.addEventListener("change", (e) => {
      proposalState.clientName = e.target.value;
    });
  }

  document.getElementById("btn-quick-client")?.addEventListener("click", () => {
    openAddClientModal(proposalState.channelId, ({ name, channelId }) => {
      if (channelId !== proposalState.channelId) {
        initProposalState(channelId);
        proposalState.clientName = name;
        render();
        return;
      }
      refreshProposalClientSelect(name);
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
        const item = proposalState.items[code];
        setChannelSrp(
          appData,
          code,
          proposalState.channelId,
          item.srpKrw,
          item.srpUsd
        );
        saveData(appData);
      }
      updateProposalCalcs(channel);
    });
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    if (!proposalState.clientName.trim()) {
      const select = document.getElementById("client-select");
      if (select?.value) proposalState.clientName = select.value;
    }
    if (!proposalState.clientName.trim()) {
      showToast("업체를 선택하거나 + 신규로 등록해주세요");
      return;
    }
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
      return {
        productCode: p.code,
        nameKor: p.nameKor,
        srpKrw: item.srpKrw,
        srpUsd: item.srpUsd,
        fobRate: proposalState.fobRate,
        fobUsd,
        fobKrw,
        poQty: item.poQty,
        amount: calcAmount(fobUsd, fobKrw, item.poQty, channel),
      };
    });
    const totalAmount = items.reduce((s, i) => s + i.amount, 0);
    const version = saveProposal(appData, {
      channelId: proposalState.channelId,
      clientName: proposalState.clientName,
      poDate: proposalState.poDate,
      fobRate: proposalState.fobRate,
      exchangeRate: proposalState.exchangeRate,
      items,
      totalAmount,
      terms,
    });
    showToast(`저장 완료 — v${version}`);
  });

  document.getElementById("btn-print").addEventListener("click", () => window.print());
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

function renderPoRow(r, i) {
  const products = getProducts(appData);
  const matched = !!r.matchedCode;
  return `
    <tr data-row-index="${i}" class="${matched ? "" : "po-row-unmatched"}">
      <td><code>${r.barcode || "-"}</code></td>
      <td class="editable">
        <select class="input-cell" data-po-field="matchedCode" data-row-index="${i}">
          <option value="">${matched ? "매칭 안됨으로 변경" : "-- 제품 선택 --"}</option>
          ${products
            .map(
              (p) =>
                `<option value="${p.code}" ${p.code === r.matchedCode ? "selected" : ""}>${p.nameKor} (${p.code})</option>`
            )
            .join("")}
        </select>
        ${!matched ? `<span class="field-hint po-hint-warn">인식된 품명: ${r.name || "-"}</span>` : ""}
      </td>
      <td>${r.spec || "-"}</td>
      <td>${r.unit || "-"}</td>
      <td class="editable">
        <input class="input-cell" type="date" data-po-field="dueDate" data-row-index="${i}" value="${r.dueDate || ""}">
      </td>
      <td class="editable">
        <input class="input-cell" type="number" step="1" min="0" data-po-field="qty" data-row-index="${i}" value="${r.qty ?? ""}">
      </td>
      <td class="editable">
        <input class="input-cell" type="number" step="1" min="0" data-po-field="unitPrice" data-row-index="${i}" value="${r.unitPrice ?? ""}">
      </td>
      <td class="editable">
        <input class="input-cell" type="number" step="1" min="0" data-po-field="amount" data-row-index="${i}" value="${r.amount ?? ""}">
      </td>
      <td><button class="btn btn-danger btn-sm" data-po-remove-row="${i}">삭제</button></td>
    </tr>
  `;
}

function renderPoUpload() {
  const channel = findChannel(poUploadState.channelId);
  const channelClients = getClients(appData, poUploadState.channelId);
  const rows = poUploadState.rows;
  const totalAmount = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const matchedCount = rows.filter((r) => r.matchedCode).length;

  return `
    <div class="help-box no-print">
      <span class="help-icon">🧾</span>
      <div>
        <strong>발주서 업로드</strong><br>
        엑셀 파일은 표를 자동으로 인식합니다. 이미지(사진·스캔본)는 OCR로 베타 인식하므로 저장 전 값을 꼭 확인해주세요.
      </div>
    </div>

    <div class="section-block no-print">
      <div class="section-label">① 채널·업체 입력</div>
      <div class="form-row">
        <div class="form-group">
          <label>판매 채널</label>
          <select id="po-channel-select">${renderChannelOptions(poUploadState.channelId)}</select>
        </div>
        <div class="form-group form-group-client">
          <label>업체명 <span class="required">*</span></label>
          <div class="input-with-action">
            <select id="po-client-select">
              ${getClientSelectOptions(poUploadState.channelId, poUploadState.clientName)}
            </select>
            <button type="button" class="btn btn-secondary" id="po-btn-quick-client">+ 신규</button>
          </div>
          ${
            channelClients.length === 0
              ? `<span class="field-hint">등록된 업체가 없습니다. <strong>+ 신규</strong> 버튼으로 추가하세요.</span>`
              : ""
          }
        </div>
        <div class="form-group">
          <label>작성일</label>
          <input type="date" id="po-date" value="${poUploadState.poDate}">
        </div>
        <div class="form-group">
          <label>발주번호</label>
          <input type="text" id="po-number" placeholder="자동 인식 또는 직접 입력" value="${poUploadState.poNumber || ""}">
        </div>
      </div>
    </div>

    <div class="section-block no-print">
      <div class="section-label">② 발주서 파일 업로드</div>
      <div class="po-dropzone" id="po-dropzone">
        <input type="file" id="po-file-input" accept=".xlsx,.xls,.csv,image/png,image/jpeg,image/jpg" hidden>
        <div class="po-dropzone-icon">📎</div>
        <p><strong>클릭하거나 파일을 끌어다 놓으세요</strong></p>
        <p class="po-dropzone-sub">엑셀(.xlsx, .xls, .csv) 또는 이미지(사진, 스캔본)</p>
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

    ${
      rows.length
        ? `
    <div class="section-block">
      <div class="section-label">③ 인식된 품목 확인 (${rows.length}건 · 제품 매칭 ${matchedCount}/${rows.length})</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>품번(바코드)</th>
              <th>제품 매칭</th>
              <th>규격</th>
              <th>단위</th>
              <th>납기일자</th>
              <th>발주수량</th>
              <th>단가</th>
              <th>금액</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="po-review-body">
            ${rows.map((r, i) => renderPoRow(r, i)).join("")}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="7" style="text-align:right;font-weight:700">합계</td>
              <td class="total-row" id="po-total-amount">${formatMoney(totalAmount, channel)}</td>
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
    `
        : ""
    }
  `;
}

function handlePoFile(file) {
  poUploadState.fileName = file.name;
  poUploadState.status = "parsing";
  poUploadState.statusMsg = "";
  poUploadState.warning = "";
  const isImage = file.type.startsWith("image/");
  poUploadState.fileKind = isImage ? "image" : "excel";
  render();

  const applyParsed = (parsed) => {
    const products = getProducts(appData);
    poUploadState.rows = matchPoRowsToProducts(parsed.rows, products);
    if (parsed.poNumber && !poUploadState.poNumber) poUploadState.poNumber = parsed.poNumber;
    if (parsed.poDate) poUploadState.poDate = parsed.poDate;
    poUploadState.warning = parsed.warning || "";
    poUploadState.status = "done";
    poUploadState.statusMsg = "";
    render();
  };

  const onFail = (err) => {
    poUploadState.status = "error";
    poUploadState.statusMsg = err.message || "파일을 인식하지 못했습니다.";
    render();
  };

  if (isImage) {
    parsePoImageFile(file, (m) => {
      if (m.status && m.progress != null) {
        poUploadState.statusMsg = `OCR 인식 중... (${m.status} ${Math.round(m.progress * 100)}%)`;
        const statusEl = document.querySelector(".po-status-parsing");
        if (statusEl) statusEl.textContent = poUploadState.statusMsg;
      }
    })
      .then(applyParsed)
      .catch(onFail);
  } else {
    parsePoExcelFile(file).then(applyParsed).catch(onFail);
  }
}

function updatePoTotals() {
  const channel = findChannel(poUploadState.channelId);
  const totalAmount = poUploadState.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const el = document.getElementById("po-total-amount");
  if (el) el.textContent = formatMoney(totalAmount, channel);
}

function savePoUpload() {
  if (!poUploadState.clientName.trim()) {
    const select = document.getElementById("po-client-select");
    if (select?.value) poUploadState.clientName = select.value;
  }
  if (!poUploadState.clientName.trim()) {
    showToast("업체를 선택하거나 + 신규로 등록해주세요");
    return;
  }
  if (!poUploadState.rows.length) {
    showToast("인식된 품목이 없습니다. 파일을 업로드해주세요");
    return;
  }
  const unmatched = poUploadState.rows.filter((r) => !r.matchedCode);
  if (unmatched.length) {
    showToast(`제품 매칭이 안 된 품목이 ${unmatched.length}건 있습니다. 매칭 후 저장해주세요`);
    return;
  }

  const channel = findChannel(poUploadState.channelId);
  const terms = getChannelTerms(appData, poUploadState.channelId);
  const products = getProducts(appData);
  const items = poUploadState.rows.map((r) => {
    const product = products.find((p) => p.code === r.matchedCode);
    const qty = r.qty ?? 0;
    const amount = r.amount ?? (r.unitPrice != null ? r.unitPrice * qty : 0);
    return {
      productCode: r.matchedCode,
      nameKor: product?.nameKor || r.name,
      srpKrw: channel.currency === "KRW" ? r.unitPrice : null,
      srpUsd: channel.currency === "USD" ? r.unitPrice : null,
      fobRate: 0,
      fobUsd: null,
      fobKrw: null,
      poQty: qty,
      amount,
    };
  });
  const totalAmount = items.reduce((s, i) => s + i.amount, 0);

  const version = saveProposal(appData, {
    channelId: poUploadState.channelId,
    clientName: poUploadState.clientName,
    poDate: poUploadState.poDate,
    poNumber: poUploadState.poNumber,
    fobRate: 0,
    exchangeRate: appData.exchangeRate,
    items,
    totalAmount,
    terms,
    source: "po-upload",
    sourceFileName: poUploadState.fileName,
  });

  showToast(`발주서가 저장되었습니다 — v${version}`);
  poUploadState = freshPoUploadState();
  setView("sales");
}

function bindPoUploadEvents() {
  document.getElementById("po-channel-select").addEventListener("change", (e) => {
    poUploadState.channelId = e.target.value;
    poUploadState.clientName = "";
    render();
  });

  const clientSelect = document.getElementById("po-client-select");
  if (clientSelect) {
    clientSelect.addEventListener("change", (e) => {
      poUploadState.clientName = e.target.value;
    });
  }

  document.getElementById("po-btn-quick-client")?.addEventListener("click", () => {
    openAddClientModal(poUploadState.channelId, ({ name, channelId }) => {
      poUploadState.channelId = channelId;
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

  document.querySelectorAll("[data-po-field]").forEach((el) => {
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, (e) => {
      const idx = parseInt(e.target.dataset.rowIndex, 10);
      const field = e.target.dataset.poField;
      const row = poUploadState.rows[idx];
      if (!row) return;
      if (field === "matchedCode") {
        row.matchedCode = e.target.value || null;
        const product = getProducts(appData).find((p) => p.code === row.matchedCode);
        row.matchedName = product ? product.nameKor : null;
        render();
        return;
      }
      if (field === "qty" || field === "unitPrice" || field === "amount") {
        row[field] = parseOptionalNumber(e.target.value);
        updatePoTotals();
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
    poUploadState.rows.push({
      barcode: "",
      name: "",
      spec: "",
      unit: "",
      dueDate: "",
      qty: null,
      unitPrice: null,
      amount: null,
      amountVat: null,
      matchedCode: null,
      matchedName: null,
    });
    render();
  });

  document.getElementById("po-btn-save")?.addEventListener("click", savePoUpload);
}

function renderProducts() {
  const products = getProducts(appData);
  return `
    <div class="help-box no-print">
      <span class="help-icon">📦</span>
      <div>신규 제품이 출시되면 아래 양식을 작성하고 <strong>제품 추가</strong> 버튼을 누르세요. 추가된 제품은 단가표에 자동으로 나타납니다.</div>
    </div>
    <div class="card no-print">
      <div class="card-title">신규 제품 추가</div>
      <form id="add-product-form" class="product-form">
        <div class="form-grid">
          <div class="form-group">
            <label>제품코드 *</label>
            <input type="text" name="code" placeholder="Br-0015" required>
          </div>
          <div class="form-group">
            <label>카테고리 *</label>
            <input type="text" name="category" placeholder="Serum" required>
          </div>
          <div class="form-group">
            <label>제품명 (KOR) *</label>
            <input type="text" name="nameKor" placeholder="바를 ..." required>
          </div>
          <div class="form-group">
            <label>제품명 (ENG) *</label>
            <input type="text" name="nameEng" placeholder="Barle ..." required>
          </div>
          <div class="form-group">
            <label>바코드</label>
            <input type="text" name="barcode" placeholder="8800259230xxx">
          </div>
          <div class="form-group">
            <label>용량</label>
            <input type="text" name="size" placeholder="50ml">
          </div>
          <div class="form-group">
            <label>박스입수량</label>
            <input type="number" name="cartonQty" value="50" min="1">
          </div>
          <div class="form-group">
            <label>카톤박스 사이즈</label>
            <input type="text" name="cartonSize" placeholder="46.5*24.2*19.5">
          </div>
          <div class="form-group">
            <label>CBM</label>
            <input type="number" name="cbm" step="0.00001" value="0.02" min="0">
          </div>
          <div class="form-group">
            <label>유통기한 (개월)</label>
            <input type="number" name="shelfLife" value="24" min="1">
          </div>
          <div class="form-group">
            <label>판매순위</label>
            <input type="number" name="salesRank" value="1" min="1">
          </div>
          <div class="form-group">
            <label>MOQ (CTN)</label>
            <input type="number" name="moq" value="50" min="1">
          </div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button type="submit" class="btn btn-primary btn-lg">+ 제품 추가</button>
        </div>
      </form>
    </div>
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
              <th>판매순위</th>
              <th>MOQ</th>
              <th class="no-print"></th>
            </tr>
          </thead>
          <tbody>
            ${products
              .map(
                (p) => `
              <tr>
                <td>${p.category}</td>
                <td><code>${p.code}</code></td>
                <td>${p.nameKor}</td>
                <td style="font-size:12px;color:var(--text-muted)">${p.nameEng}</td>
                <td style="font-size:12px">${p.barcode || "—"}</td>
                <td>${p.size || "—"}</td>
                <td>${p.cartonQty}</td>
                <td>${p.cbm}</td>
                <td>${p.shelfLife}개월</td>
                <td>${p.salesRank}</td>
                <td>${p.moq}</td>
                <td class="no-print">
                  <button class="btn btn-danger btn-sm" data-delete-code="${p.code}">삭제</button>
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
      const product = {
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
        salesRank: Number(fd.get("salesRank")) || 1,
        moq: Number(fd.get("moq")) || 50,
      };
      const result = addProduct(appData, product);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      if (currentView === "proposal") {
        proposalState.items[product.code] = { srpKrw: null, srpUsd: null, poQty: 0 };
      }
      showToast(`제품 ${product.code} 추가됨`);
      form.reset();
      render();
    });
  }
  document.querySelectorAll("[data-delete-code]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.deleteCode;
      if (!(await confirmDelete("제품 삭제", `제품코드: ${code}`))) return;
      const result = deleteProduct(appData, code);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      delete proposalState.items[code];
      showToast(`제품 ${code} 삭제됨`);
      render();
    });
  });
}

function renderChannels() {
  const channels = getChannelList();

  return `
    <div class="help-box no-print">
      <span class="help-icon">🌐</span>
      <div>판매 채널을 등록하면 <strong>단가표 만들기</strong>, <strong>소비자가 설정</strong>, <strong>거래 조건</strong> 등에 자동으로 반영됩니다.
        업체나 단가표가 연결된 채널은 삭제할 수 없습니다.</div>
    </div>
    <div class="card no-print">
      <div class="card-title">신규 채널 추가</div>
      <form id="add-channel-form">
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label>채널 코드 *</label>
            <input type="text" name="id" placeholder="예: JP, EU-UK" required pattern="[A-Za-z0-9-]+" title="영문, 숫자, 하이픈">
            <span class="field-hint">영문·숫자·하이픈 (저장 시 대문자로 변환)</span>
          </div>
          <div class="form-group">
            <label>채널명 *</label>
            <input type="text" name="name" placeholder="예: 일본, 동남아" required>
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
        <div style="margin-top:16px">
          <button type="submit" class="btn btn-primary btn-lg">+ 채널 추가</button>
        </div>
      </form>
    </div>
    <div class="card">
      <div class="card-title">등록된 채널 (${channels.length}개)</div>
      ${
        channels.length === 0
          ? `<div class="empty-state"><div class="empty-icon">🌐</div>등록된 채널이 없습니다.</div>`
          : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>채널</th>
              <th>코드</th>
              <th>통화</th>
              <th>기본 FOB</th>
              <th>등록 업체</th>
              <th>단가표</th>
              <th class="no-print"></th>
            </tr>
          </thead>
          <tbody>
            ${channels
              .map((ch) => {
                const usage = getChannelUsage(appData, ch.id);
                return `
              <tr>
                <td>${channelBadge(ch.id)} <strong>${ch.name}</strong></td>
                <td><code>${ch.id}</code></td>
                <td>${ch.currency}</td>
                <td>${Math.round(ch.defaultFobRate * 100)}%</td>
                <td>${usage.clients}개</td>
                <td>${usage.proposals}건</td>
                <td class="no-print">
                  <button class="btn btn-danger btn-sm" data-delete-channel="${ch.id}" data-channel-name="${ch.name}" data-client-count="${usage.clients}" data-proposal-count="${usage.proposals}">삭제</button>
                </td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`
      }
    </div>
  `;
}

function bindChannelEvents() {
  const form = document.getElementById("add-channel-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const result = addChannel(appData, {
        id: fd.get("id"),
        name: fd.get("name"),
        currency: fd.get("currency"),
        defaultFobRate: fd.get("defaultFobRate"),
      });
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      showToast("채널이 등록되었습니다");
      form.reset();
      render();
    });
  }

  document.querySelectorAll("[data-delete-channel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const channelId = btn.dataset.deleteChannel;
      const name = btn.dataset.channelName;
      const clientCount = parseInt(btn.dataset.clientCount, 10);
      const proposalCount = parseInt(btn.dataset.proposalCount, 10);
      const detail = [`채널: ${name}`, `코드: ${channelId}`];
      if (clientCount > 0) detail.push(`등록 업체: ${clientCount}개`);
      if (proposalCount > 0) detail.push(`단가표: ${proposalCount}건`);
      if (clientCount > 0 || proposalCount > 0) {
        detail.push("※ 연결된 데이터가 있어 삭제할 수 없습니다");
        showToast("업체나 단가표가 연결된 채널은 삭제할 수 없습니다");
        return;
      }
      if (!(await confirmDelete("채널 삭제", detail.join("\n")))) return;
      const result = deleteChannel(appData, channelId);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      if (proposalState.channelId === channelId) {
        initProposalState(getChannelList()[0]?.id);
      }
      if (termsChannelId === channelId) {
        termsChannelId = getChannelList()[0]?.id || "";
      }
      showToast(`채널 "${name}" 삭제됨`);
      render();
    });
  });
}

function renderClients() {
  const clients = getClients(appData);
  const filterChannel = document.getElementById("client-filter")?.value || clientFilter || "";
  const filtered = filterChannel ? clients.filter((c) => c.channelId === filterChannel) : clients;

  return `
    <div class="help-box no-print">
      <span class="help-icon">🏢</span>
      <div>거래처(업체)를 등록해 두면 <strong>단가표 만들기</strong>에서 목록으로 선택할 수 있습니다.
        <button type="button" class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="openAddClientModal('')">+ 빠른 등록</button>
      </div>
    </div>
    <div class="card no-print">
      <div class="card-title">신규 업체 추가</div>
      <form id="add-client-form">
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label>판매 채널 *</label>
            <select name="channelId" required>
              <option value="">채널 선택</option>
              ${renderChannelOptions("")}
            </select>
          </div>
          <div class="form-group">
            <label>업체명 *</label>
            <input type="text" name="name" placeholder="예: 올리브영 본사, OO무역" required>
          </div>
          <div class="form-group">
            <label>담당자 / 연락처</label>
            <input type="text" name="contact" placeholder="홍길동 / 010-0000-0000">
          </div>
          <div class="form-group">
            <label>메모</label>
            <input type="text" name="memo" placeholder="비고 사항">
          </div>
        </div>
        <div style="margin-top:16px">
          <button type="submit" class="btn btn-primary btn-lg">+ 업체 추가</button>
        </div>
      </form>
    </div>
    <div class="card">
      <div class="card-title">등록된 업체 목록 (${filtered.length}개)</div>
      <div class="form-row no-print" style="margin-bottom:16px">
        <div class="form-group">
          <label>채널 필터</label>
          <select id="client-filter">
            <option value="">전체 채널</option>
            ${getChannelList()
              .map(
                (ch) =>
                  `<option value="${ch.id}" ${filterChannel === ch.id ? "selected" : ""}>${ch.name}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      ${
        filtered.length === 0
          ? `<div class="empty-state"><div class="empty-icon">🏢</div>등록된 업체가 없습니다.<br>위 양식에서 업체를 추가해주세요.</div>`
          : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>채널</th>
              <th>업체명</th>
              <th>담당자/연락처</th>
              <th>메모</th>
              <th>단가표 이력</th>
              <th>등록일</th>
              <th class="no-print"></th>
            </tr>
          </thead>
          <tbody>
            ${filtered
              .map((c) => {
                const count = getClientProposalCount(appData, c);
                return `
              <tr>
                <td>${channelBadge(c.channelId)}</td>
                <td><strong>${c.name}</strong></td>
                <td>${c.contact || "—"}</td>
                <td style="font-size:13px;color:var(--text-muted)">${c.memo || "—"}</td>
                <td>${count > 0 ? `<span class="count-badge">${count}건</span>` : "—"}</td>
                <td style="font-size:13px">${new Date(c.createdAt).toLocaleDateString("ko-KR")}</td>
                <td class="no-print">
                  <button class="btn btn-danger btn-sm" data-delete-client="${c.id}" data-client-name="${c.name}" data-proposal-count="${count}">삭제</button>
                </td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`
      }
    </div>
  `;
}

function bindClientEvents() {
  const form = document.getElementById("add-client-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const result = addClient(appData, {
        channelId: fd.get("channelId"),
        name: fd.get("name"),
        contact: fd.get("contact"),
        memo: fd.get("memo"),
      });
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      showToast("업체가 등록되었습니다");
      form.reset();
      render();
    });
  }

  document.getElementById("client-filter")?.addEventListener("change", (e) => {
    clientFilter = e.target.value;
    render();
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
      if (proposalState.clientName === name) proposalState.clientName = "";
      showToast(`업체 "${name}" 삭제됨`);
      render();
    });
  });
}

function renderSrpMatrix() {
  const products = getProducts(appData);
  return `
    <div class="help-box no-print">
      <span class="help-icon">💰</span>
      <div>채널별 <strong>권장 소비자가</strong>를 미리 입력해 두면, 단가표 작성 시 자동으로 채워집니다. ₩ 또는 $ 중 하나만 입력해도 됩니다.</div>
    </div>
    <div class="card">
      <div class="card-title">채널별 소비자가</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th rowspan="2">제품코드</th>
              <th rowspan="2">제품명</th>
              ${getChannelList().map((ch) => `<th colspan="2">${ch.name}</th>`).join("")}
              <th rowspan="2" class="no-print">삭제</th>
            </tr>
            <tr>
              ${getChannelList().map(() => `<th>SRP (₩)</th><th>SRP ($)</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${products.map((p) => {
              return `
              <tr>
                <td><code>${p.code}</code></td>
                <td>${p.nameKor}</td>
                ${getChannelList().map((ch) => {
                  const srp = getChannelSrp(appData, p.code, ch.id);
                  return `
                  <td>
                    <input type="number" step="1" min="0" placeholder="미입력"
                      data-srp-code="${p.code}" data-srp-channel="${ch.id}" data-srp-type="krw"
                      value="${srp.krw ?? ""}">
                  </td>
                  <td>
                    <input type="number" step="0.01" min="0" placeholder="미입력"
                      data-srp-code="${p.code}" data-srp-channel="${ch.id}" data-srp-type="usd"
                      value="${srp.usd ?? ""}">
                  </td>`;
                }).join("")}
                <td class="no-print">
                  <button class="btn btn-danger btn-sm" data-delete-srp="${p.code}" data-product-name="${p.nameKor}">삭제</button>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function bindSrpEvents() {
  document.querySelectorAll("[data-srp-code]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const code = e.target.dataset.srpCode;
      const channelId = e.target.dataset.srpChannel;
      const type = e.target.dataset.srpType;
      const current = getChannelSrp(appData, code, channelId);
      const value = parseOptionalNumber(e.target.value);
      if (type === "krw") {
        setChannelSrp(appData, code, channelId, value, current.usd);
      } else {
        setChannelSrp(appData, code, channelId, current.krw, value);
      }
      saveData(appData);
      if (proposalState.channelId === channelId && proposalState.items[code]) {
        const updated = getChannelSrp(appData, code, channelId);
        proposalState.items[code].srpKrw = updated.krw;
        proposalState.items[code].srpUsd = updated.usd;
      }
      showToast("SRP 저장됨");
    });
  });

  document.querySelectorAll("[data-delete-srp]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.deleteSrp;
      const name = btn.dataset.productName;
      if (
        !(await confirmDelete(
          "소비자가 삭제",
          `제품: ${name}\n제품코드: ${code}\n※ 모든 채널의 소비자가가 삭제됩니다`
        ))
      )
        return;
      const result = clearSrpForProduct(appData, code);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      if (proposalState.items[code]) {
        proposalState.items[code].srpKrw = null;
        proposalState.items[code].srpUsd = null;
      }
      showToast("소비자가가 삭제되었습니다");
      render();
    });
  });
}

function renderHistory() {
  const filterChannel = historyFilter;
  const proposals = getProposals(appData, filterChannel || null);

  if (proposals.length === 0) {
    return `
      <div class="form-row no-print">
        <div class="form-group">
          <label>채널 필터</label>
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
        <label>채널 필터</label>
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
              ${p.source === "po-upload" ? `<span class="badge badge-default">발주서</span>` : ""}
              <span class="version">v${p.version}</span>
              <span>${p.clientName}</span>
              <span class="date">${p.poDate} · FOB ${p.fobRate}%</span>
              <span class="date">Total: ${formatMoney(p.totalAmount, ch)}</span>
            </div>
            <div class="history-actions no-print">
              <button class="btn btn-secondary btn-sm" data-view-id="${p.id}">보기</button>
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
        <div class="card" style="margin-top:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
            <div class="card-title" style="margin:0">v${proposal.version} — ${proposal.clientName} (${ch.name}) · ${proposal.poDate}</div>
            <div class="no-print" style="display:flex;gap:8px">
              <button class="btn btn-primary" data-excel-id="${proposal.id}">📥 엑셀 다운로드</button>
              <button class="btn btn-danger" data-delete-proposal="${proposal.id}">삭제</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>제품코드</th>
                  <th>제품명</th>
                  <th>SRP (₩)</th>
                  <th>SRP ($)</th>
                  <th>FOB%</th>
                  <th>FOB (₩)</th>
                  <th>FOB ($)</th>
                  <th>P.O Qty</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${proposal.items
                  .map((item) => {
                    const srpKrw = item.srpKrw ?? item.srp;
                    const srpUsd = item.srpUsd ?? (ch.currency === "USD" ? item.srp : null);
                    const fobKrw = item.fobKrw ?? null;
                    const fobUsd = item.fobUsd ?? null;
                    return `
                  <tr>
                    <td><code>${item.productCode}</code></td>
                    <td>${item.nameKor}</td>
                    <td>${formatKrw(srpKrw)}</td>
                    <td>${formatUsd(srpUsd)}</td>
                    <td>${item.fobRate}%</td>
                    <td>${formatKrw(fobKrw)}</td>
                    <td>${formatUsd(fobUsd)}</td>
                    <td>${item.poQty}</td>
                    <td>${formatMoney(item.amount, ch)}</td>
                  </tr>`;
                  })
                  .join("")}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="8" style="text-align:right;font-weight:700">Total</td>
                  <td class="total-row">${formatMoney(proposal.totalAmount, ch)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div class="terms-box" style="margin-top:16px">
            <h4>Terms & Conditions</h4>
            ${proposal.terms.map((t) => `<p>${t}</p>`).join("")}
          </div>
        </div>
      `;
      detail.scrollIntoView({ behavior: "smooth" });
    });
  });
}

function renderSales() {
  const summary = buildSalesSummary(appData, salesMonth);
  const [year, month] = salesMonth.split("-");
  const monthLabel = `${year}년 ${parseInt(month)}월`;

  const channelCards = summary.byChannel
    .map((ch) => {
      const amountStr =
        ch.currency === "KRW"
          ? formatKrw(ch.totalAmount)
          : formatUsd(ch.totalAmount);
      return `
        <div class="channel-summary-card ${ch.count > 0 ? "active" : ""}">
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
            ${ch.clients.length > 0 ? `업체 ${ch.clients.length}곳` : "이번 달 발주 없음"}
          </div>
        </div>`;
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
          ${monthLabel}에 저장된 발주(단가표)가 없습니다.
        </div>
      </div>
    `;
  }

  const clientRows = summary.clients
    .map(
      (c) => `
      <tr>
        <td>${channelBadge(c.channelId)} ${c.channelName}</td>
        <td><strong>${c.clientName}</strong></td>
        <td class="text-center"><span class="count-badge">${c.count}건</span></td>
        <td class="text-right amount-cell">${
          c.currency === "KRW" ? formatKrw(c.totalAmount) : formatUsd(c.totalAmount)
        }</td>
        <td>${c.lastDate}</td>
        <td class="no-print">
          <button class="btn btn-secondary btn-sm" data-sales-detail="${c.channelId}::${encodeURIComponent(c.clientName)}">상세</button>
        </td>
      </tr>`
    )
    .join("");

  return `
    <div class="help-box no-print">
      <span class="help-icon">📈</span>
      <div>
        <strong>${monthLabel}</strong> 기준 업체별 발주 현황입니다.
        저장된 단가표 1건 = 발주 1건으로 집계됩니다. 대표님이 채널별 실적을 빠르게 확인할 수 있습니다.
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

    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      ${channelCards}
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="highlight-stat">
        <span class="highlight-label">${monthLabel} 전체 발주</span>
        <span class="highlight-value">${summary.totalCount}<small>건</small></span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">업체별 발주 리스트 — ${monthLabel}</div>
      <div class="card-desc">채널·업체별로 이번 달 몇 번 발주가 들어왔는지 확인하세요.</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>채널</th>
              <th>업체명</th>
              <th style="text-align:center">발주 건수</th>
              <th style="text-align:right">합계 금액</th>
              <th>최근 발주일</th>
              <th class="no-print"></th>
            </tr>
          </thead>
          <tbody>${clientRows}</tbody>
        </table>
      </div>
    </div>

    <div id="sales-detail"></div>
  `;
}

function bindSalesEvents() {
  document.getElementById("sales-month")?.addEventListener("change", (e) => {
    salesMonth = e.target.value;
    render();
  });

  document.getElementById("btn-export-sales")?.addEventListener("click", () => {
    const summary = buildSalesSummary(appData, salesMonth);
    exportSalesSummaryToExcel(summary, salesMonth);
    showToast("영업현황 엑셀 다운로드 중...");
  });

  document.querySelectorAll("[data-sales-detail]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const [channelId, encodedName] = e.target.dataset.salesDetail.split("::");
      const clientName = decodeURIComponent(encodedName);
      const summary = buildSalesSummary(appData, salesMonth);
      const client = summary.clients.find(
        (c) => c.channelId === channelId && c.clientName === clientName
      );
      if (!client) return;
      const ch = getChannelList().find((c) => c.id === channelId);
      const detail = document.getElementById("sales-detail");
      detail.innerHTML = `
        <div class="card" style="margin-top:20px">
          <div class="card-title">${clientName} — ${ch.name} 발주 상세 (${client.count}건)</div>
          ${client.proposals
            .map(
              (p) => `
            <div class="history-item">
              <div class="history-meta">
                <span class="version">v${p.version}</span>
                <span class="date">${p.poDate}</span>
                <span>FOB ${p.fobRate}%</span>
                <span class="date">${formatMoney(p.totalAmount, ch)}</span>
              </div>
              <div class="history-actions no-print">
                <button class="btn btn-secondary btn-sm" data-view-proposal="${p.id}">보기</button>
                <button class="btn btn-primary btn-sm" data-excel-id="${p.id}">📥 엑셀</button>
                <button class="btn btn-danger btn-sm" data-delete-proposal="${p.id}">삭제</button>
              </div>
            </div>`
            )
            .join("")}
        </div>
      `;
      detail.querySelectorAll("[data-view-proposal]").forEach((b) => {
        b.addEventListener("click", () => {
          historyFilter = channelId;
          setView("history");
          setTimeout(() => {
            document.querySelector(`[data-view-id="${b.dataset.viewProposal}"]`)?.click();
          }, 100);
        });
      });
      detail.scrollIntoView({ behavior: "smooth" });
    });
  });
}

function renderTerms() {
  const channel = getChannelList().find((c) => c.id === termsChannelId);
  const terms = getChannelTerms(appData, termsChannelId);
  return `
    <div class="help-box no-print">
      <span class="help-icon">📝</span>
      <div>채널별 <strong>거래 조건(약관)</strong>을 수정합니다. 한 줄에 한 항목씩 작성하세요. 저장하면 이후 단가표에 반영됩니다.</div>
    </div>
    <div class="card">
      <div class="card-title">거래 조건 편집</div>
      <div class="form-row">
        <div class="form-group">
          <label>채널 선택</label>
          <select id="terms-channel-select">
            ${renderChannelOptions(termsChannelId)}
          </select>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label>${channel.name} — 거래 조건 (한 줄에 한 항목)</label>
        <textarea id="terms-editor" class="terms-editor" rows="12" placeholder="1. 납품 조건 : ...&#10;2. 결제 조건 : ...">${terms.join("\n")}</textarea>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary btn-lg" id="btn-save-terms">저장하기</button>
        <button class="btn btn-secondary" id="btn-reset-terms">처음 값으로 되돌리기</button>
        <button class="btn btn-danger" id="btn-clear-terms">전체 삭제</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">미리보기 — ${channel.name}</div>
      <div class="terms-box">
        ${terms.map((t) => `<p>${t}</p>`).join("")}
      </div>
    </div>
  `;
}

function bindTermsEvents() {
  document.getElementById("terms-channel-select").addEventListener("change", (e) => {
    termsChannelId = e.target.value;
    render();
  });

  document.getElementById("btn-save-terms").addEventListener("click", () => {
    const text = document.getElementById("terms-editor").value;
    const terms = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    setChannelTerms(appData, termsChannelId, terms);
    showToast("T&C 저장됨");
    render();
  });

  document.getElementById("btn-reset-terms").addEventListener("click", async () => {
    const channel = findChannel(termsChannelId);
    if (!(await confirmRestore("거래 조건 복원", `채널: ${channel.name}`))) return;
    setChannelTerms(appData, termsChannelId, getDefaultChannelTerms(appData, termsChannelId));
    showToast("기본값으로 복원됨");
    render();
  });

  document.getElementById("btn-clear-terms").addEventListener("click", async () => {
    const channel = getChannelList().find((c) => c.id === termsChannelId);
    if (!(await confirmDelete("거래 조건 삭제", `채널: ${channel.name}\n※ 모든 거래 조건 항목이 삭제됩니다`))) return;
    clearChannelTerms(appData, termsChannelId);
    showToast("거래 조건이 삭제되었습니다");
    render();
  });
}

function openProposal(channelId) {
  initProposalState(channelId);
  setView("proposal");
}

document.addEventListener("DOMContentLoaded", () => {
  initProposalState("CN");
  setupGlobalDeleteHandlers();
  setupClientModal();

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  document.getElementById("menu-toggle")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebar-overlay").classList.toggle("open");
  });

  document.getElementById("sidebar-overlay")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("open");
  });

  const meta = PAGE_META.dashboard;
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-desc").textContent = meta.desc;
  render();
});

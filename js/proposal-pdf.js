function resolveProposalItemFields(item, proposal, channel) {
  const product = getProducts(appData).find((p) => p.code === item.productCode);
  const poQty = Number(item.poQty) || 0;
  const cartonQty = item.cartonQty ?? product?.cartonQty ?? 0;
  const cbmPerCtn = item.cbm ?? product?.cbm ?? 0;
  const ctn = item.ctn != null ? item.ctn : calcCtn(poQty, cartonQty);
  const cbmQty = item.cbmQty != null ? item.cbmQty : calcCbmQty(ctn, cbmPerCtn);
  const fobRate = item.fobRate ?? proposal.fobRate;
  let fobUsd = item.fobUsd;
  let fobKrw = item.fobKrw;
  if (fobUsd == null && fobKrw == null) {
    const calc = calcFobFromSrp(
      item.srpKrw,
      item.srpUsd,
      fobRate,
      proposal.exchangeRate || DEFAULT_EXCHANGE_RATE
    );
    fobUsd = calc.fobUsd;
    fobKrw = calc.fobKrw;
  }
  const amount = item.amount ?? calcAmount(fobUsd, fobKrw, poQty, channel);
  return {
    ...item,
    category: item.category ?? product?.category ?? "",
    nameKor: item.nameKor ?? product?.nameKor ?? "",
    nameEng: item.nameEng ?? product?.nameEng ?? "",
    size: item.size ?? product?.size ?? "",
    moq: item.moq ?? product?.moq ?? "",
    cartonQty,
    cartonSize: item.cartonSize ?? product?.cartonSize ?? "",
    cbm: cbmPerCtn,
    poQty,
    ctn,
    cbmQty,
    fobRate,
    fobUsd,
    fobKrw,
    amount,
    srpKrw: item.srpKrw ?? item.srp ?? null,
    srpUsd: item.srpUsd ?? (channel?.currency === "USD" ? item.srp : null) ?? null,
  };
}

function getProposalDisplayItems(proposal) {
  const channel = getChannelList().find((c) => c.id === proposal.channelId);
  return (proposal.items || []).map((item) => resolveProposalItemFields(item, proposal, channel));
}

function getProposalDisplayTotals(items, channel) {
  return items.reduce(
    (acc, item) => {
      acc.totalAmount += item.amount || 0;
      acc.totalCtn += item.ctn || 0;
      acc.totalCbm += item.cbmQty || 0;
      return acc;
    },
    { totalAmount: 0, totalCtn: 0, totalCbm: 0 }
  );
}

function buildProposalItemSnapshot(product, item, proposal, channel, fobUsd, fobKrw) {
  const poQty = Number(item.poQty) || 0;
  const ctn = calcCtn(poQty, product.cartonQty);
  const cbmQty = calcCbmQty(ctn, product.cbm);
  return {
    productCode: product.code,
    nameKor: product.nameKor,
    nameEng: product.nameEng,
    category: product.category,
    size: product.size,
    moq: product.moq,
    cartonQty: product.cartonQty,
    cartonSize: product.cartonSize,
    cbm: product.cbm,
    srpKrw: item.srpKrw,
    srpUsd: item.srpUsd,
    fobRate: proposal.fobRate,
    fobUsd,
    fobKrw,
    poQty,
    ctn,
    cbmQty,
    amount: calcAmount(fobUsd, fobKrw, poQty, channel),
  };
}

function renderProposalDetailTableHtml(proposal, channel, options = {}) {
  const items = getProposalDisplayItems(proposal);
  const totals = getProposalDisplayTotals(items, channel);
  const compact = options.compact === true;

  const rows = items
    .map(
      (item) => `
    <tr>
      <td>${item.category}</td>
      <td><strong>${item.nameKor}</strong>${item.nameEng ? `<br><span class="proposal-doc-sub">${item.nameEng}</span>` : ""}</td>
      <td><code>${item.productCode}</code></td>
      <td>${item.size || "—"}</td>
      <td class="text-right">${formatKrw(item.srpKrw)}</td>
      <td class="text-right">${formatUsd(item.srpUsd)}</td>
      <td class="text-right">${formatKrw(item.fobKrw)}</td>
      <td class="text-right">${formatUsd(item.fobUsd)}</td>
      <td class="text-center">${item.moq ?? "—"}</td>
      <td class="text-right">${item.poQty || 0}</td>
      <td class="text-right">${formatNumber(item.ctn, 2)}</td>
      <td class="text-right">${formatNumber(item.cbmQty, 4)}</td>
      <td class="text-right amount-cell">${formatMoney(item.amount, channel)}</td>
    </tr>`
    )
    .join("");

  return `
    <div class="table-wrap proposal-detail-table-wrap${compact ? " proposal-detail-table-wrap--compact" : ""}">
      <table class="proposal-detail-table">
        <thead>
          <tr>
            <th>분류</th>
            <th>제품명</th>
            <th>제품코드</th>
            <th>용량</th>
            <th>소비자가(₩)</th>
            <th>소비자가($)</th>
            <th>FOB(₩)</th>
            <th>FOB($)</th>
            <th>MOQ</th>
            <th>주문수량</th>
            <th>박스수</th>
            <th>부피(CBM)</th>
            <th>금액</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="10" class="text-right"><strong>합계</strong></td>
            <td class="text-right total-row"><strong>${formatNumber(totals.totalCtn, 2)}</strong></td>
            <td class="text-right total-row"><strong>${formatNumber(totals.totalCbm, 4)}</strong></td>
            <td class="text-right total-row"><strong>${formatMoney(totals.totalAmount, channel)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function buildProposalDocumentHtml(proposal) {
  const channel = getChannelList().find((c) => c.id === proposal.channelId);
  const items = getProposalDisplayItems(proposal);
  const totals = getProposalDisplayTotals(items, channel);
  const terms = proposal.terms || [];

  const tableRows = items
    .map(
      (item) => `
      <tr>
        <td>${item.category}</td>
        <td>
          <div class="proposal-doc-product">${item.nameKor}</div>
          ${item.nameEng ? `<div class="proposal-doc-sub">${item.nameEng}</div>` : ""}
        </td>
        <td>${item.productCode}</td>
        <td>${item.size || "—"}</td>
        <td class="num">${formatKrw(item.srpKrw)}</td>
        <td class="num">${formatUsd(item.srpUsd)}</td>
        <td class="num">${formatKrw(item.fobKrw)}</td>
        <td class="num">${formatUsd(item.fobUsd)}</td>
        <td class="num">${item.moq ?? "—"}</td>
        <td class="num">${item.poQty || 0}</td>
        <td class="num">${formatNumber(item.ctn, 2)}</td>
        <td class="num">${formatNumber(item.cbmQty, 4)}</td>
        <td class="num">${formatMoney(item.amount, channel)}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="proposal-doc proposal-doc--plain">
      <table class="proposal-doc-table">
        <colgroup>
          <col class="col-cat">
          <col class="col-product">
          <col class="col-code">
          <col class="col-size">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-moq">
          <col class="col-qty">
          <col class="col-num">
          <col class="col-num">
          <col class="col-amount">
        </colgroup>
        <tbody class="proposal-doc-head">
          <tr class="proposal-doc-head-title">
            <td colspan="13">PRODUCT &amp; PRICE LIST</td>
          </tr>
          <tr class="proposal-doc-head-sub">
            <td colspan="13">Barle Cosmetics</td>
          </tr>
          <tr class="proposal-doc-meta-row">
            <td class="meta-label">Buyer</td>
            <td colspan="3">${proposal.clientName}</td>
            <td class="meta-label">Date</td>
            <td colspan="2">${proposal.poDate || "—"}</td>
            <td class="meta-label">Market</td>
            <td colspan="2">${channel?.name || "—"}</td>
            <td class="meta-label">Ver.</td>
            <td colspan="2">${proposal.version}</td>
          </tr>
          <tr class="proposal-doc-meta-row">
            <td class="meta-label">FOB</td>
            <td colspan="2">${proposal.fobRate}%</td>
            <td class="meta-label">Exchange</td>
            <td colspan="3">1 USD = ₩${(proposal.exchangeRate || DEFAULT_EXCHANGE_RATE).toLocaleString("ko-KR")}</td>
            <td class="meta-label">Total</td>
            <td colspan="5">${formatMoney(totals.totalAmount, channel)}</td>
          </tr>
          <tr class="proposal-doc-spacer">
            <td colspan="13"></td>
          </tr>
        </tbody>
        <thead>
          <tr>
            <th>Category</th>
            <th>Product</th>
            <th>Code</th>
            <th>Size</th>
            <th>SRP (₩)</th>
            <th>SRP ($)</th>
            <th>FOB (₩)</th>
            <th>FOB ($)</th>
            <th>MOQ</th>
            <th>Qty</th>
            <th>CTN</th>
            <th>CBM</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="10" class="total-label">TOTAL</td>
            <td class="num">${formatNumber(totals.totalCtn, 2)}</td>
            <td class="num">${formatNumber(totals.totalCbm, 4)}</td>
            <td class="num">${formatMoney(totals.totalAmount, channel)}</td>
          </tr>
        </tfoot>
      </table>

      ${
        terms.length
          ? `
      <div class="proposal-doc-terms">
        <p class="proposal-doc-terms-title">Terms &amp; Conditions</p>
        ${terms.map((t) => `<p>${t}</p>`).join("")}
      </div>`
          : ""
      }

      <p class="proposal-doc-footer">Barle Cosmetics · barle.co.kr</p>
    </div>
  `;
}

function getProposalPdfFilename(proposal) {
  const safeName = (proposal.clientName || "buyer").replace(/[/\\?%*:|"<>]/g, "_");
  return `Barle_PriceList_${safeName}_v${proposal.version}_${proposal.poDate || "draft"}.pdf`;
}

async function exportProposalToPdf(proposal) {
  if (typeof html2pdf === "undefined") {
    alert("PDF 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  const container = document.createElement("div");
  container.className = "proposal-pdf-root";
  container.innerHTML = buildProposalDocumentHtml(proposal);
  document.body.appendChild(container);

  try {
    await html2pdf()
      .set({
        margin: [8, 8, 8, 8],
        filename: getProposalPdfFilename(proposal),
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2.5,
          useCORS: true,
          letterRendering: true,
          logging: false,
          backgroundColor: "#ffffff",
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
        pagebreak: { mode: ["css", "legacy"], avoid: ".proposal-doc-terms" },
      })
      .from(container.querySelector(".proposal-doc"))
      .save();
  } finally {
    container.remove();
  }
}

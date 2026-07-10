function resolveProposalItemFields(item, proposal, channel) {
  const product = getProducts(appData).find((p) => p.code === item.productCode);
  const poQty = Number(item.poQty) || 0;
  const cartonQty = item.cartonQty ?? product?.cartonQty ?? 0;
  const cbmPerCtn = item.cbm ?? product?.cbm ?? 0;
  const ctn = item.ctn != null ? item.ctn : calcCtn(poQty, cartonQty);
  const cbmQty = item.cbmQty != null ? item.cbmQty : calcCbmQty(ctn, cbmPerCtn);
  const fobRate = item.fobRate ?? proposal.fobRate;
  const currency = getProposalCurrency(proposal, channel);
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
  const amount = item.amount ?? calcAmount(fobUsd, fobKrw, poQty, currency);
  return {
    ...item,
    category: item.category ?? product?.category ?? "",
    nameKor: item.nameKor ?? product?.nameKor ?? "",
    nameEng: item.nameEng ?? product?.nameEng ?? "",
    barcode: item.barcode ?? product?.barcode ?? "",
    hsCode: item.hsCode ?? product?.hsCode ?? "",
    countryOrigin: item.countryOrigin ?? product?.countryOrigin ?? "",
    size: item.size ?? product?.size ?? "",
    shelfLife: item.shelfLife ?? product?.shelfLife ?? null,
    moq: item.moq ?? product?.moq ?? "",
    moqPcs: item.moqPcs ?? product?.moqPcs ?? null,
    cartonQty,
    cartonSize: item.cartonSize ?? product?.cartonSize ?? "",
    cartonWeight: item.cartonWeight ?? product?.cartonWeight ?? null,
    productSize: item.productSize ?? product?.productSize ?? "",
    productWeight: item.productWeight ?? product?.productWeight ?? null,
    palletCartons: item.palletCartons ?? product?.palletCartons ?? null,
    palletPcs: item.palletPcs ?? product?.palletPcs ?? null,
    palletWeight: item.palletWeight ?? product?.palletWeight ?? null,
    productFobRate: item.productFobRate ?? product?.fobRate ?? null,
    cbm: cbmPerCtn,
    poQty,
    ctn,
    cbmQty,
    fobRate,
    fobUsd,
    fobKrw,
    amount,
    srpKrw: item.srpKrw ?? item.srp ?? null,
    srpUsd: item.srpUsd ?? (currency === "USD" ? item.srp : null) ?? null,
    msrpKrw: item.msrpKrw ?? product?.msrpKrw ?? null,
    mappKrw: item.mappKrw ?? product?.mappKrw ?? null,
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
    barcode: product.barcode,
    hsCode: product.hsCode,
    countryOrigin: product.countryOrigin,
    size: product.size,
    shelfLife: product.shelfLife,
    moq: product.moq,
    moqPcs: product.moqPcs,
    cartonQty: product.cartonQty,
    cartonSize: product.cartonSize,
    cartonWeight: product.cartonWeight,
    productSize: product.productSize,
    productWeight: product.productWeight,
    palletCartons: product.palletCartons,
    palletPcs: product.palletPcs,
    palletWeight: product.palletWeight,
    productFobRate: product.fobRate,
    cbm: product.cbm,
    srpKrw: item.srpKrw,
    srpUsd: item.srpUsd,
    msrpKrw: product.msrpKrw,
    mappKrw: product.mappKrw,
    fobRate: proposal.fobRate,
    fobUsd,
    fobKrw,
    poQty,
    ctn,
    cbmQty,
    amount: calcAmount(fobUsd, fobKrw, poQty, proposal.currency),
  };
}

function renderProposalDetailTableHtml(proposal, channel, options = {}) {
  const items = getProposalDisplayItems(proposal);
  const totals = getProposalDisplayTotals(items, channel);
  const compact = options.compact === true;
  const currency = getProposalCurrency(proposal, channel);
  const currencySymbol = currency === "KRW" ? "₩" : "$";

  const rows = items
    .map(
      (item) => `
    <tr>
      <td>${item.category}</td>
      <td>${item.barcode || "—"}</td>
      <td><strong>${item.nameKor}</strong></td>
      <td>${item.nameEng || "—"}</td>
      <td>${item.hsCode || "—"}</td>
      <td>${item.size || "—"}</td>
      <td class="text-center">${item.shelfLife ?? "—"}</td>
      <td class="text-right">${formatKrw(item.srpKrw)}</td>
      <td class="text-center">${item.productFobRate != null ? Math.round(item.productFobRate * 1000) / 10 + "%" : "—"}</td>
      <td class="text-right">${currency === "KRW" ? formatKrw(item.fobKrw) : formatUsd(item.fobUsd)}</td>
      <td class="text-right">${item.msrpKrw != null ? formatKrw(item.msrpKrw) : "—"}</td>
      <td class="text-right">${item.mappKrw != null ? formatKrw(item.mappKrw) : "—"}</td>
      <td class="text-center">${item.cartonQty ?? "—"}</td>
      <td class="text-center">${item.moqPcs ?? "—"}</td>
      <td class="text-center">${item.moq ?? "—"}</td>
      <td>${item.productSize || "—"}</td>
      <td class="text-center">${item.productWeight ?? "—"}</td>
      <td>${item.cartonSize || "—"}</td>
      <td class="text-center">${item.cartonWeight ?? "—"}</td>
      <td class="text-center">${item.palletCartons ?? "—"}</td>
      <td class="text-center">${item.palletPcs ?? "—"}</td>
      <td class="text-center">${item.palletWeight ?? "—"}</td>
      <td>${item.countryOrigin || "—"}</td>
      <td class="text-right">${item.poQty || 0}</td>
      <td class="text-right">${formatNumber(item.ctn, 2)}</td>
      <td class="text-right">${formatNumber(item.cbmQty, 4)}</td>
      <td class="text-right amount-cell">${formatMoney(item.amount, currency)}</td>
    </tr>`
    )
    .join("");

  return `
    <div class="table-wrap proposal-detail-table-wrap${compact ? " proposal-detail-table-wrap--compact" : ""}">
      <table class="proposal-detail-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Barcode</th>
            <th>Product (KOR)</th>
            <th>Product (ENG)</th>
            <th>HS Code</th>
            <th>Size</th>
            <th>Shelf Life</th>
            <th>SRP (₩)</th>
            <th>FOB Rate (%)</th>
            <th>FOB (${currencySymbol})</th>
            <th>MSRP (₩)</th>
            <th>MAPP (₩)</th>
            <th>Ctn Qty</th>
            <th>MOQ (PCS)</th>
            <th>MOQ (CTN)</th>
            <th>Product Size</th>
            <th>Product Wt (kg)</th>
            <th>Carton Size</th>
            <th>Carton Wt (kg)</th>
            <th>Pallet (CTN)</th>
            <th>Pallet (PCS)</th>
            <th>Pallet Wt (kg)</th>
            <th>Origin</th>
            <th>Order Qty</th>
            <th>CTN</th>
            <th>CBM</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="24" class="text-right"><strong>TOTAL</strong></td>
            <td class="text-right total-row"><strong>${formatNumber(totals.totalCtn, 2)}</strong></td>
            <td class="text-right total-row"><strong>${formatNumber(totals.totalCbm, 4)}</strong></td>
            <td class="text-right total-row"><strong>${formatMoney(totals.totalAmount, currency)}</strong></td>
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
  const currency = getProposalCurrency(proposal, channel);
  const currencySymbol = currency === "KRW" ? "₩" : "$";

  const tableRows = items
    .map(
      (item) => `
      <tr>
        <td>${item.category}</td>
        <td>
          <div class="proposal-doc-product">${item.nameKor}</div>
          ${item.nameEng ? `<div class="proposal-doc-sub">${item.nameEng}</div>` : ""}
        </td>
        <td>${item.barcode || "—"}</td>
        <td>${item.hsCode || "—"}</td>
        <td>${item.size || "—"}</td>
        <td class="num">${item.shelfLife ?? "—"}</td>
        <td class="num">${formatKrw(item.srpKrw)}</td>
        <td class="num">${item.productFobRate != null ? Math.round(item.productFobRate * 1000) / 10 + "%" : "—"}</td>
        <td class="num">${currency === "KRW" ? formatKrw(item.fobKrw) : formatUsd(item.fobUsd)}</td>
        <td class="num">${item.msrpKrw != null ? formatKrw(item.msrpKrw) : "—"}</td>
        <td class="num">${item.mappKrw != null ? formatKrw(item.mappKrw) : "—"}</td>
        <td class="num">${item.cartonQty ?? "—"}</td>
        <td class="num">${item.moqPcs ?? "—"}</td>
        <td class="num">${item.moq ?? "—"}</td>
        <td>${item.productSize || "—"}</td>
        <td class="num">${item.productWeight ?? "—"}</td>
        <td>${item.cartonSize || "—"}</td>
        <td class="num">${item.cartonWeight ?? "—"}</td>
        <td class="num">${item.palletCartons ?? "—"}</td>
        <td class="num">${item.palletPcs ?? "—"}</td>
        <td class="num">${item.palletWeight ?? "—"}</td>
        <td>${item.countryOrigin || "—"}</td>
        <td class="num">${item.poQty || 0}</td>
        <td class="num">${formatNumber(item.ctn, 2)}</td>
        <td class="num">${formatNumber(item.cbmQty, 4)}</td>
        <td class="num">${formatMoney(item.amount, currency)}</td>
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
          <col class="col-code">
          <col class="col-size">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-moq">
          <col class="col-moq">
          <col class="col-size">
          <col class="col-num">
          <col class="col-size">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-num">
          <col class="col-code">
          <col class="col-qty">
          <col class="col-num">
          <col class="col-num">
          <col class="col-amount">
        </colgroup>
        <tbody class="proposal-doc-sheet">
          <tr class="proposal-doc-head-title">
            <td colspan="26">
              <div class="proposal-doc-head-main">PRODUCT &amp; PRICE LIST</div>
              <div class="proposal-doc-head-subline">Barle Cosmetics</div>
            </td>
          </tr>
          <tr class="proposal-doc-meta-row">
            <td class="meta-label">Buyer</td>
            <td colspan="3">${proposal.clientName}</td>
            <td class="meta-label">Date</td>
            <td colspan="2">${proposal.poDate || "—"}</td>
            <td class="meta-label">Market</td>
            <td colspan="2">${channel?.name || "—"}</td>
            <td class="meta-label">Ver.</td>
            <td colspan="15">${proposal.version}</td>
          </tr>
          <tr class="proposal-doc-meta-row">
            <td class="meta-label">FOB</td>
            <td colspan="2">${proposal.fobRate}%</td>
            <td class="meta-label">Exchange</td>
            <td colspan="3">1 USD = ₩${(proposal.exchangeRate || DEFAULT_EXCHANGE_RATE).toLocaleString("ko-KR")}</td>
            <td class="meta-label">Total</td>
            <td colspan="18">${formatMoney(totals.totalAmount, currency)}</td>
          </tr>
          <tr class="proposal-doc-colhead">
            <td>Category</td>
            <td>Product</td>
            <td>Barcode</td>
            <td>HS Code</td>
            <td>Size</td>
            <td>Shelf Life</td>
            <td>SRP (₩)</td>
            <td>FOB Rate (%)</td>
            <td>FOB (${currencySymbol})</td>
            <td>MSRP (₩)</td>
            <td>MAPP (₩)</td>
            <td>Ctn Qty</td>
            <td>MOQ (PCS)</td>
            <td>MOQ (CTN)</td>
            <td>Product Size</td>
            <td>Product Wt (kg)</td>
            <td>Carton Size</td>
            <td>Carton Wt (kg)</td>
            <td>Pallet (CTN)</td>
            <td>Pallet (PCS)</td>
            <td>Pallet Wt (kg)</td>
            <td>Origin</td>
            <td>Qty</td>
            <td>CTN</td>
            <td>CBM</td>
            <td>Amount</td>
          </tr>
          ${tableRows}
          <tr class="proposal-doc-total">
            <td colspan="23" class="total-label">TOTAL</td>
            <td class="num">${formatNumber(totals.totalCtn, 2)}</td>
            <td class="num">${formatNumber(totals.totalCbm, 4)}</td>
            <td class="num">${formatMoney(totals.totalAmount, currency)}</td>
          </tr>
        </tbody>
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

  const el = container.querySelector(".proposal-doc");
  window.scrollTo(0, 0);

  try {
    await html2pdf()
      .set({
        margin: [1, 6, 6, 6],
        filename: getProposalPdfFilename(proposal),
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2.5,
          useCORS: true,
          letterRendering: true,
          logging: false,
          backgroundColor: "#ffffff",
          scrollX: 0,
          scrollY: 0,
          y: 0,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
        pagebreak: { mode: ["css", "legacy"], avoid: ".proposal-doc-terms" },
      })
      .from(el)
      .save();
  } finally {
    container.remove();
  }
}

const XLS_BORDER = { style: "thin", color: { argb: "FF000000" } };
const XLS_ALL_BORDERS = { top: XLS_BORDER, left: XLS_BORDER, bottom: XLS_BORDER, right: XLS_BORDER };

async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function xlsBorderRange(sheet, rowNumber, startCol, endCol) {
  for (let c = startCol; c <= endCol; c++) {
    sheet.getRow(rowNumber).getCell(c).border = XLS_ALL_BORDERS;
  }
}

// Adds a row built from [{ value, span, bold, size, align, color }] cell specs,
// merging spanned cells and bordering every covered column.
function xlsAddSpecRow(sheet, cellsSpec, { height, border = true } = {}) {
  const row = sheet.addRow([]);
  let col = 1;
  cellsSpec.forEach((spec) => {
    const span = spec.span || 1;
    const cell = row.getCell(col);
    cell.value = spec.value ?? "";
    cell.font = { bold: !!spec.bold, size: spec.size || 11, color: spec.color ? { argb: spec.color } : undefined };
    cell.alignment = { horizontal: spec.align || "left", vertical: "middle", wrapText: !!spec.wrap };
    if (span > 1) sheet.mergeCells(row.number, col, row.number, col + span - 1);
    if (border) xlsBorderRange(sheet, row.number, col, col + span - 1);
    col += span;
  });
  if (height) row.height = height;
  return row;
}

function xlsAddDataRow(sheet, values, numericCols) {
  const row = sheet.addRow(values);
  values.forEach((_, idx) => {
    const col = idx + 1;
    const cell = row.getCell(col);
    cell.border = XLS_ALL_BORDERS;
    cell.alignment = { vertical: "top", wrapText: true, horizontal: numericCols.has(col) ? "right" : "left" };
  });
  return row;
}

function xlsAddTitleWithSubline(sheet, colCount, title, subline) {
  const row = sheet.addRow([]);
  const cell = row.getCell(1);
  cell.value = {
    richText: [
      { font: { size: 16, bold: true }, text: title + "\n" },
      { font: { size: 10, color: { argb: "FF666666" } }, text: subline },
    ],
  };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.mergeCells(row.number, 1, row.number, colCount);
  xlsBorderRange(sheet, row.number, 1, colCount);
  row.height = 34;
  return row;
}

function xlsAddTermsAndFooter(sheet, colCount, terms, titleLabel = "Terms & Conditions") {
  sheet.addRow([]);
  if (terms && terms.length) {
    const titleRow = sheet.addRow([titleLabel]);
    titleRow.getCell(1).font = { bold: true };
    terms.forEach((t) => sheet.addRow([t]));
    sheet.addRow([]);
  }
  const footerRow = sheet.addRow(["Barle Cosmetics · barle.co.kr"]);
  footerRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
}

async function exportProposalToExcel(proposal) {
  if (typeof ExcelJS === "undefined") {
    alert("엑셀 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  if (getRecordType(proposal) === "estimate") {
    await exportEstimateToExcel(proposal);
    return;
  }

  const ch = getChannels(appData).find((c) => c.id === proposal.channelId);
  const items = getProposalDisplayItems(proposal);
  const currency = getProposalCurrency(proposal, ch);
  const currencySymbol = currency === "KRW" ? "₩" : "$";
  const colCount = 22;
  const numericCols = new Set([6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 19, 20, 21]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet((ch?.name || "PriceList").slice(0, 31));

  sheet.columns = [
    { width: 11 }, { width: 30 }, { width: 15 }, { width: 12 }, { width: 10 }, { width: 9 },
    { width: 10 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 10 },
    { width: 9 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 12 },
    { width: 14 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 11 },
  ];

  xlsAddTitleWithSubline(sheet, colCount, "PRODUCT & PRICE LIST", "Barle Cosmetics");

  xlsAddSpecRow(sheet, [
    { value: "Buyer", bold: true },
    { value: proposal.clientName || "—", span: 3 },
    { value: "Date", bold: true },
    { value: proposal.poDate || "—", span: 2 },
    { value: "Market", bold: true },
    { value: ch?.name || "—", span: 2 },
    { value: "Ver.", bold: true },
    { value: `v${proposal.version}`, span: 11 },
  ]);

  xlsAddSpecRow(sheet, [
    { value: "FOB", bold: true },
    { value: `${proposal.fobRate}%`, span: 2 },
    { value: "Exchange", bold: true },
    { value: `1 USD = ₩${(proposal.exchangeRate || DEFAULT_EXCHANGE_RATE).toLocaleString("ko-KR")}`, span: 18 },
  ]);

  xlsAddSpecRow(
    sheet,
    [
      "Category", "Product", "Barcode", "HS Code", "Size", "Shelf Life", "SRP (₩)", "FOB Rate (%)",
      `FOB (${currencySymbol})`, "MSRP (₩)", "MAPP (₩)", "Ctn Qty", "MOQ (PCS)", "MOQ (CTN)",
      "Product Size", "Product Wt (kg)", "Carton Size", "Carton Wt (kg)", "Pallet (CTN)",
      "Pallet (PCS)", "Pallet Wt (kg)", "Origin",
    ].map((value) => ({ value, bold: true, align: "center", wrap: true })),
    { height: 28 }
  );

  items.forEach((item) => {
    const row = sheet.addRow([
      item.category,
      "",
      item.barcode || "—",
      item.hsCode || "—",
      item.size || "—",
      item.shelfLife ?? "—",
      item.srpKrw ?? "",
      item.productFobRate != null ? Math.round(item.productFobRate * 1000) / 10 : "",
      (currency === "KRW" ? item.fobKrw : item.fobUsd) ?? "",
      item.msrpKrw ?? "",
      item.mappKrw ?? "",
      item.cartonQty ?? "—",
      item.moqPcs ?? "—",
      item.moq ?? "—",
      item.productSize || "—",
      item.productWeight ?? "",
      item.cartonSize || "—",
      item.cartonWeight ?? "",
      item.palletCartons ?? "",
      item.palletPcs ?? "",
      item.palletWeight ?? "",
      item.countryOrigin || "—",
    ]);
    row.getCell(2).value = {
      richText: [
        { font: { bold: true }, text: item.nameKor + (item.nameEng ? "\n" : "") },
        { font: { size: 9, color: { argb: "FF666666" } }, text: item.nameEng || "" },
      ],
    };
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.border = XLS_ALL_BORDERS;
      cell.alignment = { vertical: "top", wrapText: true, horizontal: numericCols.has(c) ? "right" : "left" };
    }
  });

  xlsAddTermsAndFooter(sheet, colCount, proposal.terms);

  const safeName = proposal.clientName.replace(/[/\\?%*:|"<>]/g, "_");
  const filename = `PriceList_${safeName}_v${proposal.version}_${proposal.poDate}.xlsx`;
  await downloadWorkbook(workbook, filename);
}

async function exportEstimateToExcel(proposal) {
  if (typeof ExcelJS === "undefined") {
    alert("엑셀 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  if (proposal.termsPresetName === "국내") {
    await exportDomesticEstimateToExcel(proposal);
    return;
  }

  const ch = getChannels(appData).find((c) => c.id === proposal.channelId);
  const items = getProposalDisplayItems(proposal).filter((item) => (item.poQty || 0) > 0);
  const totals = getProposalDisplayTotals(items, ch);
  const currency = getProposalCurrency(proposal, ch);
  const currencySymbol = currency === "KRW" ? "₩" : "$";
  const colCount = 6;
  const numericCols = new Set([2, 3, 4, 5, 6]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet((ch?.name || "Estimate").slice(0, 31));

  sheet.columns = [
    { width: 30 }, { width: 12 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 14 },
  ];

  xlsAddTitleWithSubline(sheet, colCount, "ESTIMATE", "Barle Cosmetics");

  xlsAddSpecRow(sheet, [
    { value: "Buyer", bold: true },
    { value: proposal.clientName || "—", span: 2 },
    { value: "Date", bold: true },
    { value: proposal.poDate || "—", span: 2 },
  ]);

  xlsAddSpecRow(sheet, [
    { value: "Market", bold: true },
    { value: ch?.name || "—", span: 2 },
    { value: "Total", bold: true },
    { value: formatMoney(totals.totalAmount, currency), span: 2 },
  ]);

  xlsAddSpecRow(
    sheet,
    ["Product", `Price (${currencySymbol})`, "Qty", "CTN", "CBM", "Amount"].map((value) => ({
      value,
      bold: true,
      align: "center",
      wrap: true,
    })),
    { height: 24 }
  );

  items.forEach((item) => {
    const row = sheet.addRow([
      "",
      (currency === "KRW" ? item.fobKrw : item.fobUsd) ?? "",
      item.poQty ?? 0,
      formatNumber(item.ctn, 2),
      formatNumber(item.cbmQty, 4),
      item.amount ?? 0,
    ]);
    row.getCell(1).value = {
      richText: [
        { font: { bold: true }, text: item.nameKor + (item.nameEng ? "\n" : "") },
        { font: { size: 9, color: { argb: "FF666666" } }, text: item.nameEng || "" },
      ],
    };
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.border = XLS_ALL_BORDERS;
      cell.alignment = { vertical: "top", wrapText: true, horizontal: numericCols.has(c) ? "right" : "left" };
    }
  });

  xlsAddSpecRow(sheet, [
    { value: "TOTAL", bold: true, span: 3, align: "right" },
    { value: formatNumber(totals.totalCtn, 2), bold: true, align: "right" },
    { value: formatNumber(totals.totalCbm, 4), bold: true, align: "right" },
    { value: formatMoney(totals.totalAmount, currency), bold: true, align: "right" },
  ]);

  xlsAddTermsAndFooter(sheet, colCount, proposal.terms);

  const safeName = proposal.clientName.replace(/[/\\?%*:|"<>]/g, "_");
  const filename = `Estimate_${safeName}_v${proposal.version}_${proposal.poDate}.xlsx`;
  await downloadWorkbook(workbook, filename);
}

async function exportDomesticEstimateToExcel(proposal) {
  const ch = getChannels(appData).find((c) => c.id === proposal.channelId);
  const items = getProposalDisplayItems(proposal).filter((item) => (item.poQty || 0) > 0);
  const colCount = 10;
  const numericCols = new Set([1, 4, 5, 6, 7, 8, 9, 10]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet((ch?.name || "견적서").slice(0, 31));

  sheet.columns = [
    { width: 5 }, { width: 26 }, { width: 14 }, { width: 16 }, { width: 9 },
    { width: 16 }, { width: 9 }, { width: 14 }, { width: 12 }, { width: 14 },
  ];

  const titleRow = sheet.addRow(["제품 공급 견적서"]);
  titleRow.getCell(1).font = { size: 16, bold: true };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, colCount);
  titleRow.height = 26;

  xlsAddSpecRow(sheet, [
    { value: "공급자", bold: true },
    { value: "Barle Cosmetics", span: 4 },
    { value: "담당자", bold: true },
    { value: proposal.staffName || "—", span: 4 },
  ]);

  xlsAddSpecRow(sheet, [
    { value: "거래처명", bold: true },
    { value: proposal.clientName || "—", span: 4 },
    { value: "견적일", bold: true },
    { value: proposal.poDate || "—", span: 4 },
  ]);

  xlsAddSpecRow(sheet, [
    { value: "연락처", bold: true },
    { value: proposal.clientContact || "—", span: 9 },
  ]);

  xlsAddSpecRow(
    sheet,
    [
      "No.", "제품명", "규격/용량", "정상 소비자가\n(VAT 포함)", "공급률",
      "공급단가\n(VAT 별도)", "수량", "공급금액", "VAT", "합계금액",
    ].map((value) => ({ value, bold: true, align: "center", wrap: true })),
    { height: 30 }
  );

  let totalSupply = 0;
  let totalVat = 0;
  items.forEach((item, i) => {
    const amount = item.amount || 0;
    const vat = Math.round(amount * 0.1);
    totalSupply += amount;
    totalVat += vat;
    xlsAddDataRow(
      sheet,
      [
        i + 1,
        item.nameKor,
        item.size || "",
        item.srpKrw ?? "",
        item.fobRate != null ? Math.round(item.fobRate * 10) / 10 : "",
        item.fobKrw ?? "",
        item.poQty || 0,
        amount,
        vat,
        amount + vat,
      ],
      numericCols
    );
  });

  xlsAddSpecRow(sheet, [
    { value: "합계", bold: true, span: 7, align: "center" },
    { value: totalSupply, bold: true, align: "right" },
    { value: totalVat, bold: true, align: "right" },
    { value: totalSupply + totalVat, bold: true, align: "right" },
  ]);

  xlsAddTermsAndFooter(sheet, colCount, proposal.terms, "거래 조건");

  const safeName = proposal.clientName.replace(/[/\\?%*:|"<>]/g, "_");
  const filename = `Estimate_${safeName}_v${proposal.version}_${proposal.poDate}.xlsx`;
  await downloadWorkbook(workbook, filename);
}

function exportSalesSummaryToExcel(summary, yearMonth) {
  if (typeof XLSX === "undefined") {
    alert("엑셀 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  const [y, m] = yearMonth.split("-");
  const rows = [
    [`바를 영업 현황 — ${y}년 ${parseInt(m)}월`],
    [],
    ["판매국가", "업체명", "발주 건수", "합계 ($)", "합계 (₩)", "최근 발주일"],
  ];

  summary.clients.forEach((c) => {
    rows.push([c.channelName, c.clientName, c.count, c.totalUsd || "", c.totalKrw || "", c.lastDate]);
  });

  rows.push([]);
  rows.push(["국가별 소계"]);
  summary.byChannel.forEach((ch) => {
    rows.push([ch.channelName, "", ch.count, ch.totalUsd || "", ch.totalKrw || "", ""]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "영업현황");
  XLSX.writeFile(wb, `영업현황_${yearMonth}.xlsx`);
}

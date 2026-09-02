function exportProposalToExcel(proposal) {
  if (typeof XLSX === "undefined") {
    alert("엑셀 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  if (getRecordType(proposal) === "estimate") {
    exportEstimateToExcel(proposal);
    return;
  }

  const ch = getChannels(appData).find((c) => c.id === proposal.channelId);
  const items = getProposalDisplayItems(proposal);
  const totals = getProposalDisplayTotals(items, ch);
  const currency = getProposalCurrency(proposal, ch);
  const currencySymbol = currency === "KRW" ? "₩" : "$";

  const rows = [
    ["PRODUCT & PRICE LIST"],
    ["Market", ch.name],
    ["Buyer", proposal.clientName],
    ["Date", proposal.poDate],
    ["Version", `v${proposal.version}`],
    ["FOB Rate (%)", proposal.fobRate],
    ["Exchange Rate (₩/USD)", proposal.exchangeRate || ""],
    [],
    [
      "Category",
      "Product (KOR)",
      "Product (ENG)",
      "Barcode",
      "HS Code",
      "Size",
      "Shelf Life",
      "SRP (₩)",
      "FOB Rate (%)",
      `FOB (${currencySymbol})`,
      "MSRP (₩)",
      "MAPP (₩)",
      "Ctn Qty",
      "MOQ (PCS)",
      "MOQ (CTN)",
      "Product Size",
      "Product Wt (kg)",
      "Carton Size",
      "Carton Wt (kg)",
      "Pallet (CTN)",
      "Pallet (PCS)",
      "Pallet Wt (kg)",
      "Origin",
      "Order Qty",
      "CTN",
      "CBM",
      "Amount",
    ],
  ];

  items.forEach((item) => {
    rows.push([
      item.category,
      item.nameKor,
      item.nameEng || "",
      item.barcode || "",
      item.hsCode || "",
      item.size || "",
      item.shelfLife ?? "",
      item.srpKrw ?? "",
      item.productFobRate != null ? Math.round(item.productFobRate * 1000) / 10 : "",
      (currency === "KRW" ? item.fobKrw : item.fobUsd) ?? "",
      item.msrpKrw ?? "",
      item.mappKrw ?? "",
      item.cartonQty ?? "",
      item.moqPcs ?? "",
      item.moq ?? "",
      item.productSize || "",
      item.productWeight ?? "",
      item.cartonSize || "",
      item.cartonWeight ?? "",
      item.palletCartons ?? "",
      item.palletPcs ?? "",
      item.palletWeight ?? "",
      item.countryOrigin || "",
      item.poQty ?? 0,
      item.ctn ?? "",
      item.cbmQty ?? "",
      item.amount ?? 0,
    ]);
  });

  rows.push([]);
  const totalRow = new Array(27).fill("");
  totalRow[0] = "TOTAL";
  totalRow[24] = totals.totalCtn;
  totalRow[25] = totals.totalCbm;
  totalRow[26] = totals.totalAmount;
  rows.push(totalRow);
  rows.push([]);
  rows.push(["Terms & Conditions"]);
  (proposal.terms || []).forEach((t) => rows.push([t]));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 11 }, // Category
    { wch: 22 }, // Product (KOR)
    { wch: 34 }, // Product (ENG)
    { wch: 14 }, // Barcode
    { wch: 12 }, // HS Code
    { wch: 10 }, // Size
    { wch: 9 }, // Shelf Life
    { wch: 10 }, // SRP
    { wch: 11 }, // FOB Rate (%)
    { wch: 10 }, // FOB
    { wch: 10 }, // MSRP
    { wch: 10 }, // MAPP
    { wch: 9 }, // Ctn Qty
    { wch: 10 }, // MOQ (PCS)
    { wch: 10 }, // MOQ (CTN)
    { wch: 14 }, // Product Size
    { wch: 12 }, // Product Wt
    { wch: 14 }, // Carton Size
    { wch: 12 }, // Carton Wt
    { wch: 10 }, // Pallet (CTN)
    { wch: 10 }, // Pallet (PCS)
    { wch: 11 }, // Pallet Wt
    { wch: 11 }, // Origin
    { wch: 10 }, // Order Qty
    { wch: 8 }, // CTN
    { wch: 8 }, // CBM
    { wch: 12 }, // Amount
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ch.name.slice(0, 31));
  const safeName = proposal.clientName.replace(/[/\\?%*:|"<>]/g, "_");
  const filename = `PriceList_${safeName}_v${proposal.version}_${proposal.poDate}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function exportEstimateToExcel(proposal) {
  if (proposal.termsPresetName === "국내") {
    exportDomesticEstimateToExcel(proposal);
    return;
  }

  const ch = getChannels(appData).find((c) => c.id === proposal.channelId);
  const items = getProposalDisplayItems(proposal).filter((item) => (item.poQty || 0) > 0);
  const totals = getProposalDisplayTotals(items, ch);
  const currency = getProposalCurrency(proposal, ch);
  const currencySymbol = currency === "KRW" ? "₩" : "$";

  const rows = [
    ["ESTIMATE"],
    ["Market", ch.name],
    ["Buyer", proposal.clientName],
    ["Date", proposal.poDate],
    ["Version", `v${proposal.version}`],
    [],
    ["Product (KOR)", "Product (ENG)", `Price (${currencySymbol})`, "Qty", "CTN", "CBM", "Amount"],
  ];

  items.forEach((item) => {
    rows.push([
      item.nameKor,
      item.nameEng || "",
      (currency === "KRW" ? item.fobKrw : item.fobUsd) ?? "",
      item.poQty ?? 0,
      item.ctn ?? "",
      item.cbmQty ?? "",
      item.amount ?? 0,
    ]);
  });

  rows.push([]);
  const totalRow = new Array(7).fill("");
  totalRow[0] = "TOTAL";
  totalRow[4] = totals.totalCtn;
  totalRow[5] = totals.totalCbm;
  totalRow[6] = totals.totalAmount;
  rows.push(totalRow);
  rows.push([]);
  rows.push(["Terms & Conditions"]);
  (proposal.terms || []).forEach((t) => rows.push([t]));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 22 }, // Product (KOR)
    { wch: 34 }, // Product (ENG)
    { wch: 12 }, // Price
    { wch: 9 }, // Qty
    { wch: 9 }, // CTN
    { wch: 9 }, // CBM
    { wch: 14 }, // Amount
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ch.name.slice(0, 31));
  const safeName = proposal.clientName.replace(/[/\\?%*:|"<>]/g, "_");
  const filename = `Estimate_${safeName}_v${proposal.version}_${proposal.poDate}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function exportDomesticEstimateToExcel(proposal) {
  const ch = getChannels(appData).find((c) => c.id === proposal.channelId);
  const items = getProposalDisplayItems(proposal).filter((item) => (item.poQty || 0) > 0);

  const rows = [
    ["제품 공급 견적서"],
    ["공급자", "Barle Cosmetics", "담당자", proposal.staffName || ""],
    ["거래처명", proposal.clientName || "", "견적일", proposal.poDate || ""],
    ["연락처", proposal.clientContact || ""],
    [],
    ["No.", "제품명", "규격/용량", "정상 소비자가(VAT포함)", "공급률", "공급단가(VAT별도)", "수량", "공급금액", "VAT", "합계금액"],
  ];

  let totalSupply = 0;
  let totalVat = 0;
  items.forEach((item, i) => {
    const amount = item.amount || 0;
    const vat = Math.round(amount * 0.1);
    totalSupply += amount;
    totalVat += vat;
    rows.push([
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
    ]);
  });

  const totalRowIndex = rows.length;
  rows.push(["합계", "", "", "", "", "", "", totalSupply, totalVat, totalSupply + totalVat]);
  rows.push([]);
  rows.push(["거래 조건"]);
  (proposal.terms || []).forEach((t) => rows.push([t]));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = [{ s: { r: totalRowIndex, c: 0 }, e: { r: totalRowIndex, c: 6 } }];
  ws["!cols"] = [
    { wch: 5 }, // No.
    { wch: 24 }, // 제품명
    { wch: 14 }, // 규격/용량
    { wch: 16 }, // 정상 소비자가
    { wch: 9 }, // 공급률
    { wch: 16 }, // 공급단가
    { wch: 9 }, // 수량
    { wch: 14 }, // 공급금액
    { wch: 12 }, // VAT
    { wch: 14 }, // 합계금액
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (ch?.name || "견적서").slice(0, 31));
  const safeName = proposal.clientName.replace(/[/\\?%*:|"<>]/g, "_");
  const filename = `Estimate_${safeName}_v${proposal.version}_${proposal.poDate}.xlsx`;
  XLSX.writeFile(wb, filename);
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

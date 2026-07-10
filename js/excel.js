function exportProposalToExcel(proposal) {
  if (typeof XLSX === "undefined") {
    alert("엑셀 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  const ch = getChannels(appData).find((c) => c.id === proposal.channelId);
  const items = getProposalDisplayItems(proposal);
  const totals = getProposalDisplayTotals(items, ch);

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
      `FOB (${ch.currencySymbol})`,
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
      (ch.currency === "KRW" ? item.fobKrw : item.fobUsd) ?? "",
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
  ws["!cols"] = new Array(27).fill({ wch: 12 });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ch.name.slice(0, 31));
  const safeName = proposal.clientName.replace(/[/\\?%*:|"<>]/g, "_");
  const filename = `PriceList_${safeName}_v${proposal.version}_${proposal.poDate}.xlsx`;
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

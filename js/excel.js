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
    ["판매국가", ch.name],
    ["업체명", proposal.clientName],
    ["작성일", proposal.poDate],
    ["버전", `v${proposal.version}`],
    ["FOB 비율 (%)", proposal.fobRate],
    ["환율 (₩/USD)", proposal.exchangeRate || ""],
    [],
    [
      "분류",
      "제품명",
      "영문명",
      "제품코드",
      "용량",
      "소비자가(₩)",
      "소비자가($)",
      "FOB(%)",
      "FOB(₩)",
      "FOB($)",
      "MOQ",
      "주문수량",
      "박스수",
      "부피(CBM)",
      "카톤입수",
      "카톤규격",
      "금액",
    ],
  ];

  items.forEach((item) => {
    rows.push([
      item.category,
      item.nameKor,
      item.nameEng || "",
      item.productCode,
      item.size || "",
      item.srpKrw ?? "",
      item.srpUsd ?? "",
      item.fobRate ?? proposal.fobRate,
      item.fobKrw ?? "",
      item.fobUsd ?? "",
      item.moq ?? "",
      item.poQty ?? 0,
      item.ctn ?? "",
      item.cbmQty ?? "",
      item.cartonQty ?? "",
      item.cartonSize || "",
      item.amount ?? 0,
    ]);
  });

  rows.push([]);
  rows.push([
    "합계",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    totals.totalCtn,
    totals.totalCbm,
    "",
    "",
    totals.totalAmount,
  ]);
  rows.push([]);
  rows.push(["Terms & Conditions"]);
  (proposal.terms || []).forEach((t) => rows.push([t]));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 28 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 8 },
    { wch: 12 },
    { wch: 10 },
    { wch: 8 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 16 },
    { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ch.name.slice(0, 31));
  const safeName = proposal.clientName.replace(/[/\\?%*:|"<>]/g, "_");
  const filename = `단가표_${safeName}_v${proposal.version}_${proposal.poDate}.xlsx`;
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

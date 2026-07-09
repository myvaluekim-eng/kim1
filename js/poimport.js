const PO_CORE_HEADERS = [
  { key: "name", test: /품명|제품명/ },
  { key: "qty", test: /발주\s*수량|^수량$/ },
  { key: "unitPrice", test: /단가/ },
  { key: "amount", test: /^금액$/ },
];

const PO_EXTRA_HEADERS = [
  { key: "no", test: /^no\.?$|^번호$/i },
  { key: "barcode", test: /품번|바코드/ },
  { key: "spec", test: /규격/ },
  { key: "unit", test: /^단위$/ },
  { key: "dueDate", test: /납기/ },
  { key: "amountVat", test: /합계.*부가세|합계/ },
];

const PO_ALL_HEADERS = [...PO_CORE_HEADERS, ...PO_EXTRA_HEADERS];

function poCompact(text) {
  return String(text || "").replace(/\s/g, "");
}

function poNormalizeNumber(value) {
  if (value == null) return null;
  const s = String(value).replace(/[^0-9.\-]/g, "");
  if (s === "" || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function poNormalizeDateText(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})\s*[.\-\/년]\s*0?(\d{1,2})\s*[.\-\/월]?\s*0?(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function poExtractPoNumber(text) {
  const compact = poCompact(text);
  let m = compact.match(/발주번호[:：]?(P0\d{10,}|[A-Z]?\d{5,})/i);
  if (m) return m[1];
  m = compact.match(/(P0\d{10,})/i);
  return m ? m[1] : null;
}

function poExtractPoDate(text) {
  const t = String(text || "");
  let m = t.match(/(\d{4})\s*년\s*0?(\d{1,2})\s*월\s*0?(\d{1,2})\s*일/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  m = t.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  return null;
}

function isOliveYoungPoText(text) {
  const compact = poCompact(text);
  return (
    /홍천엠앤티|올리브영/.test(compact) ||
    /발주번호[:：]?P0\d{10}/i.test(compact) ||
    /비고.*OY|OY.*입고/.test(compact)
  );
}

function poIsSubtotalRow(text) {
  const c = poCompact(text);
  return /^소계/.test(c) || c === "소계" || /^금액합계/.test(c);
}

function poIsHeaderLikeRow(text) {
  const c = poCompact(text);
  return /품명.*발주수량|발주수량.*단가|품번.*품명|^no\.?품번/i.test(c);
}

function poCoreHeaderScore(found) {
  const coreCount = PO_CORE_HEADERS.filter((h) => found[h.key] != null).length;
  return coreCount * 10 + Object.keys(found).length;
}

function poFindHeadersInRow(row) {
  const found = {};
  row.forEach((cell, idx) => {
    const text = poCompact(cell);
    if (!text) return;
    for (const def of PO_ALL_HEADERS) {
      if (def.test.test(text) && found[def.key] == null) {
        found[def.key] = idx;
        break;
      }
    }
  });
  for (let i = 0; i < row.length - 1; i++) {
    const joined = poCompact(row[i]) + poCompact(row[i + 1]);
    for (const def of PO_ALL_HEADERS) {
      if (def.test.test(joined) && found[def.key] == null) {
        found[def.key] = i;
        break;
      }
    }
  }
  return found;
}

function poExtractNumbersFromTail(text, excludeText) {
  let work = text;
  if (excludeText) work = work.replace(excludeText, " ");
  const dueDateMatch = work.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  let numsPart = work;
  if (dueDateMatch) {
    numsPart = work.slice(work.indexOf(dueDateMatch[0]) + dueDateMatch[0].length);
  }
  const nums = poFilterQtyNumbers(
    [...numsPart.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)/g)]
      .map((m) => poNormalizeNumber(m[0]))
      .filter((n) => n != null)
  );
  return { nums, dueDateMatch };
}

function parsePoCoreLine(lineText) {
  const line = poNormalizeOcrText(String(lineText || "").trim());
  if (!line || poIsSubtotalRow(line) || poIsHeaderLikeRow(line)) return null;

  const specMatch = line.match(/(\d+\s*EA\s*\/?\s*\d+)/i);
  const barcodeMatch = line.match(/(8800\d{9,12})/);
  const barcode = barcodeMatch ? poNormalizeBarcode(barcodeMatch[0]) : "";

  const { nums, dueDateMatch } = poExtractNumbersFromTail(line, barcodeMatch ? barcodeMatch[0] : "");
  if (nums.length < 3) return null;

  let qty, unitPrice, amount, amountVat;
  if (nums.length >= 4) {
    [qty, unitPrice, amount, amountVat] = nums.slice(-4);
  } else {
    [qty, unitPrice, amount] = nums.slice(-3);
  }

  if (qty != null && unitPrice != null && amount != null) {
    const expected = qty * unitPrice;
    if (expected > 0 && Math.abs(expected - amount) / expected > 0.15 && nums.length >= 4) {
      [qty, unitPrice, amount] = nums.slice(-3);
      amountVat = nums[nums.length - 1] > amount ? nums[nums.length - 1] : null;
    }
  }

  let name = "";
  if (barcodeMatch) {
    name = line.slice(line.indexOf(barcodeMatch[0]) + barcodeMatch[0].length);
  } else {
    const korean = line.match(/(바를[가-힣0-9a-zA-Z\s()\-+.*%mlg\/]+|[가-힣][가-힣0-9a-zA-Z\s()\-+.*%mlg\/]{3,})/);
    name = korean ? korean[1] : "";
  }

  if (specMatch) {
    const idx = name.indexOf(specMatch[0]);
    if (idx >= 0) name = name.slice(0, idx);
  }
  if (dueDateMatch) name = name.replace(dueDateMatch[0], "");
  name = name
    .replace(/^\d+[\s.)]+/, "")
    .replace(/\bEA\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (name.length < 2 && !barcode) return null;
  if (poIsTitleNoise(name) && !barcode) return null;
  if (qty == null && amount == null) return null;

  const row = {
    barcode,
    name,
    spec: specMatch ? specMatch[0].replace(/\s/g, "") : "",
    unit: /\bEA\b/i.test(line) ? "EA" : "",
    dueDate: dueDateMatch ? poNormalizeDateText(dueDateMatch[0]) : "",
    qty,
    unitPrice,
    amount,
    amountVat: amountVat ?? null,
  };
  return poIsValidProductRow(row) ? row : null;
}

function poMergeMultilineRows(rawLines) {
  const merged = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    if (poIsHeaderLikeRow(line) || poIsSubtotalRow(line) || /구매발주서|발주번호/.test(line)) {
      merged.push(line);
      continue;
    }

    const hasKorean = /[가-힣]{2,}/.test(line) || /바를/.test(line);
    const hasNums = /(\d{1,3}(?:,\d{3})+|\d{4,})/.test(line);
    const hasBarcode = /8800\d{9}|\d{13}/.test(line);

    if ((hasKorean || hasBarcode) && !hasNums && i + 1 < rawLines.length) {
      const next = rawLines[i + 1];
      if (
        /(\d{1,3}(?:,\d{3})+|\d+)/.test(next) &&
        !poIsSubtotalRow(next) &&
        !poIsHeaderLikeRow(next)
      ) {
        line = `${line} ${next}`;
        i++;
      }
    }
    merged.push(line);
  }
  return merged;
}

function poNormalizeOcrText(text) {
  let t = String(text || "")
    .replace(/(\d),\s+(\d)/g, "$1$2")
    .replace(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g, "$1-$2-$3")
    .replace(/바\s*를/g, "바를")
    .replace(/발\s*주\s*수\s*량/g, "발주수량")
    .replace(/[|｜]/g, " ");

  t = t.replace(/8800(?:[\s\d]{10,20})/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.startsWith("8800") && digits.length >= 12) return digits.slice(0, 13);
    return match.replace(/\s/g, "");
  });
  return t;
}

function poFilterQtyNumbers(nums) {
  return nums.filter((n) => {
    const s = String(Math.round(n));
    if (s.length >= 12 && s.startsWith("8800")) return false;
    if (n > 999999999) return false;
    return true;
  });
}

function poIsTitleNoise(name) {
  const c = poCompact(name);
  const raw = String(name || "").trim();
  if (!c) return true;
  if (/구매발주서|구매.*발주|발주서/.test(c)) return true;
  if (/주식회사|홍천|플리에|귀중|사업장|대표자|전화|팩스|tel|fax/i.test(c)) return true;
  if (/^구매|^발주|^매발주/.test(c)) return true;
  if (/\bif\b/i.test(raw) && !/바를/.test(raw)) return true;
  return false;
}

function poIsValidProductRow(row) {
  if (!row || poIsTitleNoise(row.name)) return false;

  const name = String(row.name || "").trim();
  const qty = row.qty;
  const unitPrice = row.unitPrice;
  const amount = row.amount;
  if (!name || name.length < 2) return false;
  if (qty == null || amount == null) return false;
  if (qty < 1 || qty > 500000) return false;
  if (amount < 1) return false;

  if (unitPrice != null && unitPrice > 0) {
    const expected = qty * unitPrice;
    if (expected > 0 && Math.abs(expected - amount) / expected > 0.15) return false;
  }

  return true;
}

function poFilterValidRows(rows) {
  return (rows || []).filter(poIsValidProductRow);
}

function poNormalizeBarcode(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("8800")) return digits.slice(0, 13);
  return digits.length >= 10 ? digits : "";
}

function parsePoByBarcodeBlocks(text) {
  const normalized = poNormalizeOcrText(text);
  const matches = [...normalized.matchAll(/8800\d{9}/g)];
  if (!matches.length) return [];

  const rows = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    const chunk = normalized.slice(start, end);
    if (poIsSubtotalRow(chunk)) break;
    const row = parsePoCoreLine(chunk.trim());
    if (row) rows.push(row);
  }
  return poFilterValidRows(rows);
}

function parsePoFromOcrBlocks(text) {
  const lines = poNormalizeOcrText(text)
    .split(/\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const combined = buffer.join(" ");
    const row = parsePoCoreLine(combined);
    if (row && poIsValidProductRow(row)) rows.push(row);
    buffer = [];
  };

  for (const line of lines) {
    if (poIsSubtotalRow(line)) {
      flush();
      break;
    }
    if (/8800\d{9}/.test(line) && buffer.length) flush();

    const isDataLine =
      /8800\d{9}/.test(line) ||
      /바를/.test(line) ||
      /\d{4}-\d{1,2}-\d{1,2}/.test(line) ||
      /(\d{1,3}(?:,\d{3})+|\d{2,})/.test(line);

    if (isDataLine) buffer.push(line);

    const combined = buffer.join(" ");
    const hasBarcode = /8800\d{9}/.test(combined);
    const { nums } = poExtractNumbersFromTail(combined);
    if (hasBarcode && nums.length >= 3 && /바를/.test(combined)) flush();
  }
  flush();
  return poFilterValidRows(rows);
}

function parsePoAllStrategies(text) {
  const normalized = poNormalizeOcrText(text);
  const strategies = [
    () => parsePoByBarcodeBlocks(normalized),
    () => parsePoFromOcrBlocks(normalized),
    () => poFilterValidRows(parsePoCoreText(normalized)),
  ];

  let best = [];
  for (const fn of strategies) {
    const rows = fn();
    if (rows.length > best.length) best = rows;
  }
  return best;
}

function parsePoCoreText(text) {
  const normalized = poNormalizeOcrText(text);
  const rawLines = normalized
    .split(/\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean);

  const lines = poMergeMultilineRows(rawLines);
  const rows = [];

  for (const line of lines) {
    if (poIsSubtotalRow(line)) break;
    const row = parsePoCoreLine(line);
    if (row) rows.push(row);
  }

  if (rows.length) return poFilterValidRows(rows);
  return poFilterValidRows(parsePoByBarcodeBlocks(normalized));
}

function poNormalizeNameForMatch(name) {
  return String(name || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/기획|트래블\s*키트|온|세트/g, "")
    .replace(/[^\w가-힣]/g, "")
    .toLowerCase();
}

function matchPoProduct(products, { barcode, name }) {
  if (barcode) {
    const digits = String(barcode).replace(/\D/g, "");
    if (digits) {
      const exact = products.find((p) => p.barcode && p.barcode.replace(/\D/g, "") === digits);
      if (exact) return exact.code;
    }
  }
  if (name) {
    const n = poNormalizeNameForMatch(name);
    if (n.length >= 4) {
      const hit = products.find((p) => {
        const pn = poNormalizeNameForMatch(p.nameKor);
        if (!pn || pn.length < 4) return false;
        const core = n.slice(0, Math.min(8, n.length));
        const pCore = pn.slice(0, Math.min(8, pn.length));
        return pn.includes(core) || n.includes(pCore) || pn.includes(n) || n.includes(pn);
      });
      if (hit) return hit.code;
    }
  }
  return null;
}

function matchPoRowsToProducts(rows, products) {
  return rows.map((r) => {
    const matchedCode = matchPoProduct(products, { barcode: r.barcode, name: r.name });
    const product = products.find((p) => p.code === matchedCode);
    return { ...r, matchedCode: matchedCode || null, matchedName: product ? product.nameKor : null };
  });
}

function poRowFromColumns(row, colMap) {
  const cell = (key) => (colMap[key] != null ? row[colMap[key]] : "");
  const name = String(cell("name") || "").trim();
  const qty = poNormalizeNumber(cell("qty"));
  const unitPrice = poNormalizeNumber(cell("unitPrice"));
  const amount = poNormalizeNumber(cell("amount"));
  const barcodeText = String(cell("barcode") || "").trim();
  const barcodeMatch = barcodeText.match(/\d{10,14}/) || row.join(" ").match(/\d{13}|8800\d{9}/);

  if (poIsHeaderLikeRow(name) || poIsSubtotalRow(name)) return null;
  if (!name && !barcodeMatch) return null;
  if (qty == null && unitPrice == null && amount == null) {
    const lineRow = parsePoCoreLine(row.join(" "));
    if (lineRow) return lineRow;
    return null;
  }

  return {
    barcode: barcodeMatch ? barcodeMatch[0] : barcodeText,
    name: name || "",
    spec: String(cell("spec") || "").trim(),
    unit: String(cell("unit") || "").trim(),
    dueDate: poNormalizeDateText(cell("dueDate")),
    qty,
    unitPrice,
    amount,
    amountVat: poNormalizeNumber(cell("amountVat")),
  };
}

function parsePoMatrix(matrix) {
  const allText = matrix.map((row) => row.join(" ")).join("\n");

  let headerRowIdx = -1;
  let colMap = {};
  let bestScore = 0;

  for (let i = 0; i < Math.min(matrix.length, 100); i++) {
    const found = poFindHeadersInRow(matrix[i]);
    const score = poCoreHeaderScore(found);
    if (score >= 30 && score > bestScore) {
      bestScore = score;
      headerRowIdx = i;
      colMap = found;
    }
  }

  let rows = [];
  if (headerRowIdx >= 0) {
    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const row = matrix[r];
      const rowText = row.join(" ");
      if (poIsSubtotalRow(rowText)) break;
      const built = poRowFromColumns(row, colMap);
      if (built && built.name) rows.push(built);
    }
  }

  if (!rows.length) {
    rows = parsePoAllStrategies(allText);
  }

  rows = poFilterValidRows(rows);

  return {
    poNumber: poExtractPoNumber(allText),
    poDate: poExtractPoDate(allText),
    rows,
    isOliveYoung: isOliveYoungPoText(allText),
    warning: rows.length ? null : "품명·발주수량·단가·금액을 찾지 못했습니다. 아래 표에 직접 입력해주세요.",
  };
}

function parsePoExcelFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === "undefined") {
      reject(new Error("엑셀 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        let best = null;
        wb.SheetNames.forEach((sheetName) => {
          const ws = wb.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
          const parsed = parsePoMatrix(matrix);
          if (!best || parsed.rows.length > best.rows.length) best = parsed;
        });
        resolve(best || parsePoMatrix([]));
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function poExtractOcrWords(data) {
  if (Array.isArray(data.words) && data.words.length) {
    return data.words.map((w) => ({ text: w.text, bbox: w.bbox }));
  }
  if (Array.isArray(data.lines) && data.lines.length) {
    const out = [];
    data.lines.forEach((line) => (line.words || []).forEach((w) => out.push({ text: w.text, bbox: w.bbox })));
    if (out.length) return out;
  }
  if (Array.isArray(data.blocks) && data.blocks.length) {
    const out = [];
    data.blocks.forEach((b) =>
      (b.paragraphs || []).forEach((p) =>
        (p.lines || []).forEach((l) => (l.words || []).forEach((w) => out.push({ text: w.text, bbox: w.bbox })))
      )
    );
    if (out.length) return out;
  }
  return null;
}

function poBuildColumnRanges(colAnchors) {
  const entries = Object.entries(colAnchors).sort((a, b) => a[1] - b[1]);
  return entries.map(([key, x], idx) => ({
    key,
    min: idx === 0 ? 0 : (entries[idx - 1][1] + x) / 2 - 15,
    max: idx + 1 < entries.length ? (x + entries[idx + 1][1]) / 2 - 15 : Infinity,
  }));
}

function poColumnTexts(lineWords, columns) {
  const buckets = {};
  lineWords.forEach((w) => {
    const col = columns.find((c) => w.xc >= c.min && w.xc < c.max);
    if (!col) return;
    if (!buckets[col.key]) buckets[col.key] = [];
    buckets[col.key].push(w.text);
  });
  return {
    name: (buckets.name || []).join(" ").replace(/^\d+\s*/, "").trim(),
    qty: poNormalizeNumber((buckets.qty || []).join("")),
    unitPrice: poNormalizeNumber((buckets.unitPrice || []).join("")),
    amount: poNormalizeNumber((buckets.amount || []).join("")),
  };
}

function poGroupOcrLines(words) {
  const ws = words
    .filter((w) => w.text?.trim())
    .map((w) => ({
      text: w.text.trim(),
      x0: w.bbox.x0,
      y0: w.bbox.y0,
      x1: w.bbox.x1,
      y1: w.bbox.y1,
      xc: (w.bbox.x0 + w.bbox.x1) / 2,
      yc: (w.bbox.y0 + w.bbox.y1) / 2,
    }));
  if (!ws.length) return [];

  const hMed = ws.reduce((s, w) => s + (w.y1 - w.y0), 0) / ws.length || 15;
  const yThresh = hMed * 0.55;
  const lines = [];

  ws.forEach((w) => {
    let line = lines.find((l) => Math.abs(l.yc - w.yc) < yThresh);
    if (!line) {
      line = { yc: w.yc, words: [] };
      lines.push(line);
    }
    line.words.push(w);
    line.yc = line.words.reduce((s, x) => s + x.yc, 0) / line.words.length;
  });
  lines.forEach((l) => l.words.sort((a, b) => a.x0 - b.x0));
  lines.sort((a, b) => a.yc - b.yc);
  return lines;
}

function parsePoTableFromOcrWords(words, fullText) {
  const lines = poGroupOcrLines(words);
  if (!lines.length) return null;

  let headerIdx = -1;
  let colAnchors = {};
  for (let i = 0; i < lines.length; i++) {
    const anchors = {};
    lines[i].words.forEach((w) => {
      const c = poCompact(w.text);
      if (/품명|제품명/.test(c)) anchors.name = w.xc;
      if (/발주수량/.test(c) || c === "수량") anchors.qty = w.xc;
      if (/단가/.test(c)) anchors.unitPrice = w.xc;
      if (c === "금액") anchors.amount = w.xc;
    });
    const core = ["name", "qty", "unitPrice", "amount"].filter((k) => anchors[k] != null).length;
    if (core >= 3) {
      headerIdx = i;
      colAnchors = anchors;
      break;
    }
  }

  if (headerIdx === -1) return null;

  const columns = poBuildColumnRanges(colAnchors);
  const rows = [];
  let pending = null;

  const flushPending = () => {
    if (!pending) return;
    if (poIsValidProductRow(pending)) rows.push(pending);
    pending = null;
  };

  let seenProduct = false;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const lineText = lines[i].words.map((w) => w.text).join(" ");
    if (poIsSubtotalRow(lineText)) break;

    const cols = poColumnTexts(lines[i].words, columns);
    const barcodeMatch = lineText.match(/8800\d{9,12}/);
    const hasBarle = /바를/.test(lineText) || /바를/.test(cols.name);

    if (!seenProduct) {
      if (!barcodeMatch && !hasBarle) continue;
      seenProduct = true;
    }

    if (poIsTitleNoise(cols.name) && !hasBarle && !barcodeMatch) continue;

    const isNewRow = /^[1-9]\s/.test(lineText) || barcodeMatch || hasBarle;

    if (isNewRow && pending) flushPending();

    const base = {
      barcode: barcodeMatch ? poNormalizeBarcode(barcodeMatch[0]) : "",
      name: cols.name,
      spec: "",
      unit: "EA",
      dueDate: poNormalizeDateText(lineText),
      qty: cols.qty,
      unitPrice: cols.unitPrice,
      amount: cols.amount,
      amountVat: null,
    };

    if (!base.name && !base.barcode && base.qty == null && base.amount == null) continue;

    if (!pending) {
      pending = base;
      continue;
    }

    pending.name = [pending.name, base.name].filter(Boolean).join(" ").trim();
    pending.qty ??= base.qty;
    pending.unitPrice ??= base.unitPrice;
    pending.amount ??= base.amount;
    pending.barcode = pending.barcode || base.barcode;
    pending.dueDate = pending.dueDate || base.dueDate;
    if (pending.qty != null || pending.amount != null) flushPending();
  }
  flushPending();

  const validRows = poFilterValidRows(rows);
  if (!validRows.length) return null;

  return {
    poNumber: poExtractPoNumber(fullText),
    poDate: poExtractPoDate(fullText),
    rows: validRows,
    isOliveYoung: isOliveYoungPoText(fullText),
    warning: "표 열(품명·발주수량·단가·금액) 기준으로 인식했습니다. 저장 전 확인해주세요.",
  };
}

function preprocessPoImageFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      resolve(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.max(1.5, 2200 / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = gray > 200 ? 255 : gray < 90 ? 0 : gray < 140 ? 0 : 255;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob || file);
        }, "image/png");
      } catch (err) {
        URL.revokeObjectURL(url);
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function poFinalizeParseResult(parsed, fullText) {
  parsed = parsed || parsePoFromPlainText(fullText);
  parsed.rows = poFilterValidRows(parsed.rows);
  if (!parsed.rows.length) {
    const retry = parsePoAllStrategies(fullText);
    if (retry.length) parsed.rows = retry;
  }
  if (!parsed.rows.length && isOliveYoungPoText(fullText)) {
    parsed.isOliveYoung = true;
    parsed.warning =
      "올리브영 발주서로 확인되지만 품목을 읽지 못했습니다. 아래 표에 직접 입력해주세요.";
  }
  parsed.rawText = fullText;
  return parsed;
}

function parsePoFromOcrWords(words, fullText) {
  const tableParsed = parsePoTableFromOcrWords(words, fullText);
  if (tableParsed?.rows?.length) return poFinalizeParseResult(tableParsed, fullText);

  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const avgHeight = sorted.reduce((s, w) => s + (w.bbox.y1 - w.bbox.y0), 0) / sorted.length || 20;
  const lineThreshold = avgHeight * 0.55;

  const lines = [];
  sorted.forEach((w) => {
    const yc = (w.bbox.y0 + w.bbox.y1) / 2;
    let line = lines.find((l) => Math.abs(l.yc - yc) < lineThreshold);
    if (!line) {
      line = { yc, words: [] };
      lines.push(line);
    }
    line.words.push(w);
    line.yc = line.words.reduce((s, x) => s + (x.bbox.y0 + x.bbox.y1) / 2, 0) / line.words.length;
  });
  lines.forEach((l) => l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  lines.sort((a, b) => a.yc - b.yc);

  const lineTexts = lines.map((l) => l.words.map((w) => w.text).join(" "));
  const mergedText = poMergeMultilineRows(lineTexts).join("\n");
  let rows = parsePoCoreText(mergedText);

  if (!rows.length) {
    let headerLineIdx = -1;
    let colBounds = [];
    let bestScore = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineCompact = lines[i].words.map((w) => w.text).join("");
      const found = {};
      for (const def of PO_ALL_HEADERS) {
        if (def.test.test(poCompact(lineCompact))) found[def.key] = true;
      }
      const score = poCoreHeaderScore(
        Object.fromEntries(Object.keys(found).map((k) => [k, 0]))
      );
      if (score >= 30 && score > bestScore) {
        bestScore = score;
        headerLineIdx = i;
        const matches = [];
        lines[i].words.forEach((w) => {
          const clean = poCompact(w.text);
          for (const def of PO_ALL_HEADERS) {
            if (def.test.test(clean)) matches.push({ key: def.key, x0: w.bbox.x0 });
          }
        });
        colBounds = matches;
      }
    }

    if (headerLineIdx >= 0 && colBounds.length) {
      colBounds.sort((a, b) => a.x0 - b.x0);
      const columns = colBounds.map((c, idx) => ({
        key: c.key,
        start: c.x0 - 25,
        end: idx + 1 < colBounds.length ? colBounds[idx + 1].x0 - 25 : Infinity,
      }));

      for (let i = headerLineIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        const lineText = line.words.map((w) => w.text).join(" ");
        if (poIsSubtotalRow(lineText)) break;

        const coreLine = parsePoCoreLine(lineText);
        if (coreLine) {
          rows.push(coreLine);
          continue;
        }

        const fields = {};
        line.words.forEach((w) => {
          const col = columns.find((c) => w.bbox.x0 >= c.start && w.bbox.x0 < c.end) || columns[columns.length - 1];
          fields[col.key] = fields[col.key] ? `${fields[col.key]} ${w.text}` : w.text;
        });

        const built = {
          barcode: (fields.barcode || lineText).match(/\d{10,14}/)?.[0] || "",
          name: (fields.name || "").trim(),
          spec: (fields.spec || "").trim(),
          unit: (fields.unit || "").trim(),
          dueDate: poNormalizeDateText(fields.dueDate || ""),
          qty: poNormalizeNumber(fields.qty),
          unitPrice: poNormalizeNumber(fields.unitPrice),
          amount: poNormalizeNumber(fields.amount),
          amountVat: poNormalizeNumber(fields.amountVat),
        };
        if (built.name && (built.qty != null || built.amount != null)) rows.push(built);
      }
    }
  }

  if (!rows.length) {
    rows = parsePoAllStrategies(fullText);
  }

  return poFinalizeParseResult(
    {
      poNumber: poExtractPoNumber(fullText),
      poDate: poExtractPoDate(fullText),
      rows,
      isOliveYoung: isOliveYoungPoText(fullText),
      warning: rows.length
        ? "OCR 인식 결과입니다. 품명·수량·단가·금액을 확인해주세요."
        : "자동 인식에 실패했습니다. 아래 표에 직접 입력하거나 엑셀 파일을 업로드해주세요.",
    },
    fullText
  );
}

function parsePoFromPlainText(text) {
  const rows = parsePoAllStrategies(text);
  return {
    poNumber: poExtractPoNumber(text),
    poDate: poExtractPoDate(text),
    rows,
    isOliveYoung: isOliveYoungPoText(text),
    warning: rows.length
      ? "인식 결과입니다. 품명·수량·단가·금액을 확인해주세요."
      : "자동 인식에 실패했습니다. 아래 표에 직접 입력하거나 엑셀 파일을 업로드해주세요.",
    rawText: text,
  };
}

function ensurePdfJsWorker() {
  if (typeof pdfjsLib === "undefined") return;
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
}

function pdfTextContentToLines(textContent) {
  if (!textContent?.items?.length) return "";
  const items = textContent.items
    .filter((item) => item.str?.trim())
    .map((item) => ({
      str: item.str.trim(),
      y: item.transform[5],
      x: item.transform[4],
    }));
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  let text = "";
  let lastY = null;
  for (const item of items) {
    if (lastY !== null && Math.abs(item.y - lastY) > 3) text += "\n";
    else if (text && !text.endsWith("\n")) text += " ";
    text += item.str;
    lastY = item.y;
  }
  return text;
}

async function pdfPageToImageFile(page, pageNum) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([blob || new Blob()], `po-page-${pageNum}.png`, { type: "image/png" });
}

function mergePoPdfPages(pages, fullText) {
  const allRows = [];
  let poNumber = null;
  let poDate = null;
  let isOliveYoung = false;

  for (const p of pages) {
    if (p?.rows?.length) allRows.push(...p.rows);
    poNumber ||= p?.poNumber;
    poDate ||= p?.poDate;
    isOliveYoung ||= p?.isOliveYoung;
  }

  const rows = poFilterValidRows(allRows);
  return poFinalizeParseResult(
    {
      poNumber: poNumber || poExtractPoNumber(fullText),
      poDate: poDate || poExtractPoDate(fullText),
      rows,
      isOliveYoung: isOliveYoung || isOliveYoungPoText(fullText),
      warning: rows.length
        ? "PDF 스캔 이미지(OCR)로 인식했습니다. 저장 전 확인해주세요."
        : "PDF에서 품목을 찾지 못했습니다. 아래 표에 직접 입력해주세요.",
    },
    fullText
  );
}

function parsePoPdfFile(file, onProgress) {
  return (async () => {
    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.");
    }
    ensurePdfJsWorker();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    let fullText = "";
    for (let i = 1; i <= numPages; i++) {
      onProgress?.({ status: "pdf-text", progress: (i / numPages) * 0.35 });
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += pdfTextContentToLines(textContent) + "\n\n";
    }

    let parsed = poFinalizeParseResult(parsePoFromPlainText(fullText), fullText);
    if (parsed.rows.length >= 1) {
      parsed.warning =
        parsed.warning ||
        "PDF 텍스트에서 품목을 인식했습니다. 저장 전 확인해주세요.";
      return parsed;
    }

    const ocrResults = [];
    for (let i = 1; i <= numPages; i++) {
      onProgress?.({ status: "pdf-ocr", progress: 0.35 + (i / numPages) * 0.65 });
      const page = await pdf.getPage(i);
      const imgFile = await pdfPageToImageFile(page, i);
      const pageParsed = await parsePoImageFile(imgFile, onProgress);
      ocrResults.push(pageParsed);
    }

    return mergePoPdfPages(ocrResults, fullText);
  })();
}

function parsePoImageFile(file, onProgress) {
  return (async () => {
    if (typeof Tesseract === "undefined") {
      throw new Error("OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.");
    }

    const input = await preprocessPoImageFile(file);
    const logger = (m) => onProgress && onProgress(m);

    async function runOcr(recognizeInput, psm) {
      const psmMode = psm || Tesseract.PSM?.SINGLE_BLOCK || "6";
      try {
        const worker = await Tesseract.createWorker("kor+eng", 1, { logger });
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: psmMode,
            preserve_interword_spaces: "1",
          });
          return await worker.recognize(recognizeInput);
        } finally {
          await worker.terminate();
        }
      } catch (_) {
        return Tesseract.recognize(recognizeInput, "kor+eng", { logger });
      }
    }

    function parseOcrAttempt(result) {
      const fullText = result.data.text || "";
      const words = poExtractOcrWords(result.data) || [];

      let parsed = null;
      if (words.length) parsed = parsePoTableFromOcrWords(words, fullText);
      if (!parsed?.rows?.length) {
        const barcodeRows = parsePoByBarcodeBlocks(fullText);
        if (barcodeRows.length) {
          parsed = {
            poNumber: poExtractPoNumber(fullText),
            poDate: poExtractPoDate(fullText),
            rows: barcodeRows,
            isOliveYoung: isOliveYoungPoText(fullText),
            warning: "바코드 기준으로 품목을 인식했습니다. 저장 전 확인해주세요.",
          };
        }
      }
      if (!parsed?.rows?.length && words.length) parsed = parsePoFromOcrWords(words, fullText);
      if (!parsed?.rows?.length) parsed = parsePoFromPlainText(fullText);
      return poFinalizeParseResult(parsed, fullText);
    }

    const psmModes = [
      Tesseract.PSM?.SINGLE_BLOCK || "6",
      Tesseract.PSM?.SINGLE_COLUMN || "4",
      Tesseract.PSM?.SPARSE_TEXT || "11",
    ];

    let best = null;
    for (const psm of psmModes) {
      const result = await runOcr(input, psm);
      const parsed = parseOcrAttempt(result);
      if (!best || parsed.rows.length > best.rows.length) best = parsed;
      if (parsed.rows.length >= 1) break;
    }

    return best || parseOcrAttempt(await runOcr(input));
  })();
}

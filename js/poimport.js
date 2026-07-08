const PO_HEADER_DEFS = [
  { key: "no", test: /^no\.?$|^번호$/i },
  { key: "barcode", test: /품번|바코드/ },
  { key: "name", test: /품명|제품명/ },
  { key: "spec", test: /규격/ },
  { key: "unit", test: /^단위$/ },
  { key: "dueDate", test: /납기/ },
  { key: "qty", test: /발주수량|수량/ },
  { key: "unitPrice", test: /단가/ },
  { key: "amount", test: /^금액$/ },
  { key: "amountVat", test: /합계/ },
];

function poNormalizeNumber(value) {
  if (value == null) return null;
  const s = String(value).replace(/[^0-9.\-]/g, "");
  if (s === "" || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function poNormalizeDateText(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})\s*[.\-\/년]\s*0?(\d{1,2})\s*[.\-\/월]\s*0?(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function poExtractPoNumber(text) {
  const m = String(text || "").match(/발주\s*번호\s*[:：]?\s*([A-Za-z]?\d[\dA-Za-z-]{4,})/);
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

function matchPoProduct(products, { barcode, name }) {
  if (barcode) {
    const digits = String(barcode).replace(/\D/g, "");
    if (digits) {
      const hit = products.find((p) => p.barcode && p.barcode.replace(/\D/g, "") === digits);
      if (hit) return hit.code;
    }
  }
  if (name) {
    const n = name.replace(/\s+/g, "");
    if (n) {
      const hit = products.find((p) => {
        const pn = p.nameKor.replace(/\s+/g, "");
        return pn && n && (pn.includes(n) || n.includes(pn));
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

function parsePoMatrix(matrix) {
  const allText = matrix.map((row) => row.join(" ")).join("\n");

  let headerRowIdx = -1;
  let colMap = {};
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    const found = {};
    row.forEach((cell, idx) => {
      const text = String(cell || "").replace(/\s/g, "");
      if (!text) return;
      for (const def of PO_HEADER_DEFS) {
        if (def.test.test(text) && found[def.key] == null) {
          found[def.key] = idx;
          break;
        }
      }
    });
    if (Object.keys(found).length >= 4) {
      headerRowIdx = i;
      colMap = found;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return {
      poNumber: poExtractPoNumber(allText),
      poDate: poExtractPoDate(allText),
      rows: [],
      warning: "표 헤더를 인식하지 못했습니다. 아래 표에 직접 입력해주세요.",
    };
  }

  const rows = [];
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    const rowText = row.join("").replace(/\s/g, "");
    if (/소계|합계/.test(rowText)) break;

    const barcodeText = colMap.barcode != null ? row[colMap.barcode] : "";
    const nameText = colMap.name != null ? row[colMap.name] : "";
    if (!String(barcodeText || "").trim() && !String(nameText || "").trim()) continue;

    const barcodeDigits = String(barcodeText || "").match(/\d{6,}/);
    rows.push({
      barcode: barcodeDigits ? barcodeDigits[0] : String(barcodeText || "").trim(),
      name: String(nameText || "").trim(),
      spec: colMap.spec != null ? String(row[colMap.spec] || "").trim() : "",
      unit: colMap.unit != null ? String(row[colMap.unit] || "").trim() : "",
      dueDate: poNormalizeDateText(colMap.dueDate != null ? row[colMap.dueDate] : ""),
      qty: poNormalizeNumber(colMap.qty != null ? row[colMap.qty] : null),
      unitPrice: poNormalizeNumber(colMap.unitPrice != null ? row[colMap.unitPrice] : null),
      amount: poNormalizeNumber(colMap.amount != null ? row[colMap.amount] : null),
      amountVat: poNormalizeNumber(colMap.amountVat != null ? row[colMap.amountVat] : null),
    });
  }

  return {
    poNumber: poExtractPoNumber(allText),
    poDate: poExtractPoDate(allText),
    rows,
    warning: rows.length ? null : "표 데이터를 찾지 못했습니다. 아래 표에 직접 입력해주세요.",
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
        const ws = wb.Sheets[wb.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        resolve(parsePoMatrix(matrix));
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

function parsePoFromOcrWords(words, fullText) {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const avgHeight = sorted.reduce((s, w) => s + (w.bbox.y1 - w.bbox.y0), 0) / sorted.length || 20;
  const lineThreshold = avgHeight * 0.6;

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

  let headerLineIdx = -1;
  let colBounds = [];
  for (let i = 0; i < lines.length; i++) {
    const matches = [];
    lines[i].words.forEach((w) => {
      const clean = w.text.replace(/\s/g, "");
      for (const def of PO_HEADER_DEFS) {
        if (def.test.test(clean)) {
          matches.push({ key: def.key, x0: w.bbox.x0 });
          break;
        }
      }
    });
    const uniqueKeys = new Set(matches.map((m) => m.key));
    if (uniqueKeys.size >= 4) {
      headerLineIdx = i;
      colBounds = matches;
      break;
    }
  }

  if (headerLineIdx === -1) {
    return {
      poNumber: poExtractPoNumber(fullText),
      poDate: poExtractPoDate(fullText),
      rows: [],
      warning: "표 헤더를 인식하지 못했습니다. 아래 표에 직접 입력해주세요.",
      rawText: fullText,
    };
  }

  colBounds.sort((a, b) => a.x0 - b.x0);
  const columns = colBounds.map((c, idx) => ({
    key: c.key,
    start: c.x0 - 20,
    end: idx + 1 < colBounds.length ? colBounds[idx + 1].x0 - 20 : Infinity,
  }));

  const rows = [];
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const lineText = line.words.map((w) => w.text).join(" ");
    if (/소계|합\s*계/.test(lineText.replace(/\s/g, ""))) break;

    const fields = {};
    line.words.forEach((w) => {
      const col = columns.find((c) => w.bbox.x0 >= c.start && w.bbox.x0 < c.end) || columns[columns.length - 1];
      fields[col.key] = fields[col.key] ? `${fields[col.key]} ${w.text}` : w.text;
    });
    if (!fields.barcode && !fields.name) continue;

    const barcodeDigits = (fields.barcode || "").match(/\d{6,}/);
    rows.push({
      barcode: barcodeDigits ? barcodeDigits[0] : (fields.barcode || "").trim(),
      name: (fields.name || "").trim(),
      spec: (fields.spec || "").trim(),
      unit: (fields.unit || "").trim(),
      dueDate: poNormalizeDateText(fields.dueDate || ""),
      qty: poNormalizeNumber(fields.qty),
      unitPrice: poNormalizeNumber(fields.unitPrice),
      amount: poNormalizeNumber(fields.amount),
      amountVat: poNormalizeNumber(fields.amountVat),
    });
  }

  return {
    poNumber: poExtractPoNumber(fullText),
    poDate: poExtractPoDate(fullText),
    rows,
    warning: rows.length ? null : "표 데이터를 인식하지 못했습니다. 아래 표에 직접 입력해주세요.",
    rawText: fullText,
  };
}

function parsePoFromPlainText(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];

  for (const line of lines) {
    if (/소계|합\s*계/.test(line.replace(/\s/g, ""))) break;
    const barcodeMatch = line.match(/\b(\d{10,14})\b/);
    if (!barcodeMatch) continue;

    const barcode = barcodeMatch[1];
    let rest = line.slice(barcodeMatch.index + barcode.length).trim();
    const dueDateMatch = rest.match(/\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/);
    const specMatch = rest.match(/\d+\s*EA\s*\/\s*\d+/i);
    const numTokens = rest.match(/[\d,]{2,}/g) || [];

    let name = rest;
    if (dueDateMatch) name = name.replace(dueDateMatch[0], "");
    if (specMatch) name = name.replace(specMatch[0], "");
    numTokens.forEach((t) => (name = name.replace(t, "")));
    name = name.replace(/\bEA\b/gi, "").replace(/\s+/g, " ").trim();

    const trailing = numTokens.slice(-4);
    const [qty, unitPrice, amount, amountVat] = [
      trailing[trailing.length - 4],
      trailing[trailing.length - 3],
      trailing[trailing.length - 2],
      trailing[trailing.length - 1],
    ];

    rows.push({
      barcode,
      name,
      spec: specMatch ? specMatch[0] : "",
      unit: /\bEA\b/i.test(rest) ? "EA" : "",
      dueDate: poNormalizeDateText(dueDateMatch ? dueDateMatch[0] : ""),
      qty: poNormalizeNumber(qty),
      unitPrice: poNormalizeNumber(unitPrice),
      amount: poNormalizeNumber(amount),
      amountVat: poNormalizeNumber(amountVat),
    });
  }

  return {
    poNumber: poExtractPoNumber(text),
    poDate: poExtractPoDate(text),
    rows,
    warning: rows.length
      ? "표 형식을 단순 인식했습니다. 값을 꼭 확인해주세요."
      : "표 데이터를 인식하지 못했습니다. 아래 표에 직접 입력해주세요.",
    rawText: text,
  };
}

function parsePoImageFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (typeof Tesseract === "undefined") {
      reject(new Error("OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요."));
      return;
    }
    Tesseract.recognize(file, "kor+eng", {
      logger: (m) => onProgress && onProgress(m),
    })
      .then((result) => {
        const words = poExtractOcrWords(result.data);
        if (words && words.length) {
          resolve(parsePoFromOcrWords(words, result.data.text || ""));
        } else {
          resolve(parsePoFromPlainText(result.data.text || ""));
        }
      })
      .catch(reject);
  });
}

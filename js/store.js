const STORAGE_KEY = "barle-sales-data";

function normalizeSrpEntry(value) {
  if (value == null) return { krw: null, usd: null };
  if (typeof value === "number") return { krw: null, usd: value };
  return {
    krw: value.krw ?? null,
    usd: value.usd ?? null,
  };
}

function initChannelSrpForProduct(data, productCode) {
  if (!data.channelSrp[productCode]) {
    data.channelSrp[productCode] = {};
    CHANNELS.forEach((ch) => {
      data.channelSrp[productCode][ch.id] = { krw: null, usd: null };
    });
  }
}

function migrateData(data) {
  if (!data.products || data.products.length === 0) {
    data.products = structuredClone(DEFAULT_PRODUCTS);
  }
  if (!data.channelSrp) data.channelSrp = structuredClone(DEFAULT_SRP);
  getProducts(data).forEach((p) => {
    initChannelSrpForProduct(data, p.code);
    CHANNELS.forEach((ch) => {
      data.channelSrp[p.code][ch.id] = normalizeSrpEntry(data.channelSrp[p.code][ch.id]);
    });
  });
  if (!data.channelTerms) {
    data.channelTerms = {};
    CHANNELS.forEach((ch) => {
      data.channelTerms[ch.id] = [...ch.terms];
    });
  }
  CHANNELS.forEach((ch) => {
    if (!data.channelTerms[ch.id]) data.channelTerms[ch.id] = [...ch.terms];
  });
  if (!data.exchangeRate) data.exchangeRate = DEFAULT_EXCHANGE_RATE;
  if (!data.proposals) data.proposals = [];
  if (!data.clients) {
    data.clients = [];
    const seen = new Set();
    data.proposals.forEach((p) => {
      const key = `${p.channelId}::${p.clientName}`;
      if (!p.clientName || seen.has(key)) return;
      seen.add(key);
      data.clients.push({
        id: `migrated-${p.channelId}-${p.clientName}`,
        name: p.clientName,
        channelId: p.channelId,
        contact: "",
        memo: "",
        createdAt: p.createdAt || new Date().toISOString(),
      });
    });
  }
  return data;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateData(JSON.parse(raw));
  } catch (_) {}
  return migrateData({
    products: structuredClone(DEFAULT_PRODUCTS),
    channelSrp: structuredClone(DEFAULT_SRP),
    channelTerms: Object.fromEntries(CHANNELS.map((ch) => [ch.id, [...ch.terms]])),
    exchangeRate: DEFAULT_EXCHANGE_RATE,
    proposals: [],
    clients: [],
  });
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getProducts(data) {
  return data.products?.length ? data.products : structuredClone(DEFAULT_PRODUCTS);
}

function addProduct(data, product) {
  const products = getProducts(data);
  if (products.some((p) => p.code === product.code)) {
    return { ok: false, error: "이미 존재하는 제품코드입니다." };
  }
  data.products = [...products, product];
  initChannelSrpForProduct(data, product.code);
  saveData(data);
  return { ok: true };
}

function deleteProduct(data, code) {
  const products = getProducts(data);
  if (products.length <= 1) {
    return { ok: false, error: "최소 1개 제품은 유지해야 합니다." };
  }
  data.products = products.filter((p) => p.code !== code);
  delete data.channelSrp[code];
  saveData(data);
  return { ok: true };
}

function getChannelTerms(data, channelId) {
  return data.channelTerms?.[channelId] ?? CHANNELS.find((c) => c.id === channelId)?.terms ?? [];
}

function setChannelTerms(data, channelId, terms) {
  if (!data.channelTerms) data.channelTerms = {};
  data.channelTerms[channelId] = terms;
  saveData(data);
}

function getChannelSrp(data, productCode, channelId) {
  return normalizeSrpEntry(data.channelSrp[productCode]?.[channelId]);
}

function setChannelSrp(data, productCode, channelId, srpKrw, srpUsd) {
  if (!data.channelSrp[productCode]) data.channelSrp[productCode] = {};
  data.channelSrp[productCode][channelId] = {
    krw: srpKrw === "" || srpKrw == null ? null : Number(srpKrw),
    usd: srpUsd === "" || srpUsd == null ? null : Number(srpUsd),
  };
}

function saveProposal(data, proposal) {
  const channelProposals = data.proposals.filter((p) => p.channelId === proposal.channelId);
  const version = channelProposals.length + 1;
  data.proposals.unshift({
    ...proposal,
    id: Date.now().toString(),
    version,
    createdAt: new Date().toISOString(),
  });
  saveData(data);
  return version;
}

function getProposals(data, channelId) {
  if (!channelId) return data.proposals;
  return data.proposals.filter((p) => p.channelId === channelId);
}

function getProposalById(data, id) {
  return data.proposals.find((p) => p.id === id);
}

function getProposalDate(proposal) {
  return proposal.poDate || proposal.createdAt?.slice(0, 10) || "";
}

function filterProposalsByMonth(proposals, yearMonth) {
  if (!yearMonth) return proposals;
  return proposals.filter((p) => getProposalDate(p).startsWith(yearMonth));
}

function buildSalesSummary(data, yearMonth) {
  const proposals = filterProposalsByMonth(data.proposals, yearMonth);
  const clientMap = {};

  proposals.forEach((p) => {
    const ch = CHANNELS.find((c) => c.id === p.channelId);
    const key = `${p.channelId}::${p.clientName}`;
    if (!clientMap[key]) {
      clientMap[key] = {
        channelId: p.channelId,
        channelName: ch.name,
        currency: ch.currency,
        clientName: p.clientName,
        count: 0,
        totalAmount: 0,
        lastDate: "",
        proposals: [],
      };
    }
    const entry = clientMap[key];
    entry.count += 1;
    entry.totalAmount += p.totalAmount || 0;
    entry.proposals.push(p);
    const date = getProposalDate(p);
    if (date > entry.lastDate) entry.lastDate = date;
  });

  const clients = Object.values(clientMap).sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);

  const byChannel = CHANNELS.map((ch) => {
    const channelProposals = proposals.filter((p) => p.channelId === ch.id);
    return {
      channelId: ch.id,
      channelName: ch.name,
      currency: ch.currency,
      count: channelProposals.length,
      totalAmount: channelProposals.reduce((s, p) => s + (p.totalAmount || 0), 0),
      clients: [...new Set(channelProposals.map((p) => p.clientName))],
    };
  });

  return {
    yearMonth,
    totalCount: proposals.length,
    clients,
    byChannel,
    proposals,
  };
}

function getClients(data, channelId) {
  const clients = data.clients || [];
  if (!channelId) return clients;
  return clients.filter((c) => c.channelId === channelId);
}

function addClient(data, client) {
  const name = client.name?.trim();
  if (!name) return { ok: false, error: "업체명을 입력해주세요." };
  if (!client.channelId) return { ok: false, error: "채널을 선택해주세요." };

  const exists = (data.clients || []).some(
    (c) => c.channelId === client.channelId && c.name === name
  );
  if (exists) return { ok: false, error: "같은 채널에 이미 등록된 업체입니다." };

  if (!data.clients) data.clients = [];
  data.clients.push({
    id: Date.now().toString(),
    name,
    channelId: client.channelId,
    contact: client.contact?.trim() || "",
    memo: client.memo?.trim() || "",
    createdAt: new Date().toISOString(),
  });
  saveData(data);
  return { ok: true };
}

function deleteClient(data, clientId) {
  const client = (data.clients || []).find((c) => c.id === clientId);
  if (!client) return { ok: false, error: "업체를 찾을 수 없습니다." };

  const proposalCount = data.proposals.filter(
    (p) => p.channelId === client.channelId && p.clientName === client.name
  ).length;

  data.clients = data.clients.filter((c) => c.id !== clientId);
  saveData(data);
  return { ok: true, proposalCount };
}

function deleteProposal(data, id) {
  const proposal = data.proposals.find((p) => p.id === id);
  if (!proposal) return { ok: false, error: "단가표를 찾을 수 없습니다." };
  data.proposals = data.proposals.filter((p) => p.id !== id);
  saveData(data);
  return { ok: true, proposal };
}

function clearSrpForProduct(data, productCode) {
  if (!data.channelSrp[productCode]) return { ok: false, error: "제품을 찾을 수 없습니다." };
  CHANNELS.forEach((ch) => {
    data.channelSrp[productCode][ch.id] = { krw: null, usd: null };
  });
  saveData(data);
  return { ok: true };
}

function clearChannelTerms(data, channelId) {
  if (!data.channelTerms) data.channelTerms = {};
  data.channelTerms[channelId] = [];
  saveData(data);
  return { ok: true };
}

function getClientProposalCount(data, client) {
  return data.proposals.filter(
    (p) => p.channelId === client.channelId && p.clientName === client.name
  ).length;
}

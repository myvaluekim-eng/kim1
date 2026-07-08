const STORAGE_KEY = "barle-sales-data";

function normalizeSrpEntry(value) {
  if (value == null) return { krw: null, usd: null };
  if (typeof value === "number") return { krw: null, usd: value };
  return {
    krw: value.krw ?? null,
    usd: value.usd ?? null,
  };
}

function getChannels(data) {
  return data.channels?.length ? data.channels : structuredClone(DEFAULT_CHANNELS);
}

function initChannelSrpForProduct(data, productCode) {
  if (!data.channelSrp[productCode]) {
    data.channelSrp[productCode] = {};
  }
  getChannels(data).forEach((ch) => {
    if (!data.channelSrp[productCode][ch.id]) {
      data.channelSrp[productCode][ch.id] = { krw: null, usd: null };
    }
  });
}

function migrateChannels(data) {
  if (!data.channels || data.channels.length === 0) {
    data.channels = structuredClone(DEFAULT_CHANNELS);
  }
  if (!data.channelTerms) data.channelTerms = {};
  getChannels(data).forEach((ch) => {
    if (!data.channelTerms[ch.id]) {
      const def = DEFAULT_CHANNELS.find((d) => d.id === ch.id);
      data.channelTerms[ch.id] = def ? [...def.terms] : [...(ch.terms || [])];
    }
  });
}

function migrateData(data) {
  if (!data.products || data.products.length === 0) {
    data.products = structuredClone(DEFAULT_PRODUCTS);
  }
  migrateChannels(data);
  if (!data.channelSrp) data.channelSrp = structuredClone(DEFAULT_SRP);
  getProducts(data).forEach((p) => {
    initChannelSrpForProduct(data, p.code);
    getChannels(data).forEach((ch) => {
      data.channelSrp[p.code][ch.id] = normalizeSrpEntry(data.channelSrp[p.code][ch.id]);
    });
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
    channels: structuredClone(DEFAULT_CHANNELS),
    channelSrp: structuredClone(DEFAULT_SRP),
    channelTerms: Object.fromEntries(DEFAULT_CHANNELS.map((ch) => [ch.id, [...ch.terms]])),
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
  return data.channelTerms?.[channelId] ?? DEFAULT_CHANNELS.find((c) => c.id === channelId)?.terms ?? [];
}

function getDefaultChannelTerms(data, channelId) {
  const def = DEFAULT_CHANNELS.find((c) => c.id === channelId);
  if (def) return [...def.terms];
  const ch = getChannels(data).find((c) => c.id === channelId);
  return ch?.terms ? [...ch.terms] : [];
}

function addChannel(data, channel) {
  const id = channel.id?.trim().toUpperCase();
  if (!id) return { ok: false, error: "채널 코드를 입력해주세요." };
  if (!/^[A-Z0-9-]+$/.test(id)) {
    return { ok: false, error: "채널 코드는 영문, 숫자, 하이픈(-)만 사용할 수 있습니다." };
  }
  const name = channel.name?.trim();
  if (!name) return { ok: false, error: "채널명을 입력해주세요." };

  const channels = getChannels(data);
  if (channels.some((c) => c.id === id)) {
    return { ok: false, error: "이미 존재하는 채널 코드입니다." };
  }

  const currency = channel.currency === "KRW" ? "KRW" : "USD";
  const fobPercent = parseFloat(channel.defaultFobRate);
  const newChannel = {
    id,
    name,
    currency,
    currencySymbol: currency === "KRW" ? "₩" : "$",
    defaultFobRate: (isNaN(fobPercent) ? 30 : fobPercent) / 100,
    terms: [],
  };

  data.channels = [...channels, newChannel];
  getProducts(data).forEach((p) => {
    if (!data.channelSrp[p.code]) data.channelSrp[p.code] = {};
    data.channelSrp[p.code][id] = { krw: null, usd: null };
  });
  if (!data.channelTerms) data.channelTerms = {};
  data.channelTerms[id] = [];
  saveData(data);
  return { ok: true };
}

function updateChannel(data, channelId, updates) {
  const channels = getChannels(data);
  const idx = channels.findIndex((c) => c.id === channelId);
  if (idx === -1) return { ok: false, error: "채널을 찾을 수 없습니다." };

  const name = updates.name?.trim();
  if (!name) return { ok: false, error: "채널명을 입력해주세요." };

  const currency = updates.currency === "KRW" ? "KRW" : "USD";
  const fobPercent = parseFloat(updates.defaultFobRate);
  const defaultFobRate = isNaN(fobPercent)
    ? channels[idx].defaultFobRate
    : fobPercent / 100;

  channels[idx] = {
    ...channels[idx],
    name,
    currency,
    currencySymbol: currency === "KRW" ? "₩" : "$",
    defaultFobRate,
  };
  data.channels = channels;
  saveData(data);
  return { ok: true };
}

function deleteChannel(data, channelId) {
  const channels = getChannels(data);
  if (channels.length <= 1) {
    return { ok: false, error: "최소 1개 채널은 유지해야 합니다." };
  }

  const clientCount = (data.clients || []).filter((c) => c.channelId === channelId).length;
  const proposalCount = data.proposals.filter((p) => p.channelId === channelId).length;
  if (clientCount > 0 || proposalCount > 0) {
    return {
      ok: false,
      error: `이 채널에 등록된 업체 ${clientCount}개, 단가표 ${proposalCount}건이 있어 삭제할 수 없습니다.`,
    };
  }

  data.channels = channels.filter((c) => c.id !== channelId);
  getProducts(data).forEach((p) => {
    if (data.channelSrp[p.code]) delete data.channelSrp[p.code][channelId];
  });
  if (data.channelTerms) delete data.channelTerms[channelId];
  saveData(data);
  return { ok: true };
}

function getChannelUsage(data, channelId) {
  return {
    clients: (data.clients || []).filter((c) => c.channelId === channelId).length,
    proposals: data.proposals.filter((p) => p.channelId === channelId).length,
  };
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
    const ch = getChannels(data).find((c) => c.id === p.channelId);
    const key = `${p.channelId}::${p.clientName}`;
    if (!clientMap[key]) {
      clientMap[key] = {
        channelId: p.channelId,
        channelName: ch?.name || p.channelId,
        currency: ch?.currency || "USD",
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

  const byChannel = getChannels(data).map((ch) => {
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

function updateClient(data, clientId, updates) {
  const client = (data.clients || []).find((c) => c.id === clientId);
  if (!client) return { ok: false, error: "업체를 찾을 수 없습니다." };

  const name = updates.name?.trim();
  if (!name) return { ok: false, error: "업체명을 입력해주세요." };

  const channelId = updates.channelId || client.channelId;
  if (!channelId) return { ok: false, error: "채널을 선택해주세요." };

  const duplicate = (data.clients || []).some(
    (c) => c.id !== clientId && c.channelId === channelId && c.name === name
  );
  if (duplicate) return { ok: false, error: "같은 채널에 이미 등록된 업체입니다." };

  const oldName = client.name;
  const oldChannelId = client.channelId;

  if (name !== oldName || channelId !== oldChannelId) {
    data.proposals.forEach((p) => {
      if (p.channelId === oldChannelId && p.clientName === oldName) {
        p.channelId = channelId;
        p.clientName = name;
      }
    });
  }

  client.name = name;
  client.channelId = channelId;
  client.contact = updates.contact?.trim() || "";
  client.memo = updates.memo?.trim() || "";
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
  getChannels(data).forEach((ch) => {
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

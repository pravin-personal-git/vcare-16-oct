"use strict";

// src/config.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var DEFAULTS = {
  pollSeconds: 300,
  overlapMinutes: 2880,
  // two days - covers a reader offline over a weekend
  // The reader's clock skew, not the timezone - India time is applied by the
  // adapter. Atlas sends the real value on every check-in anyway.
  clockOffsetMinutes: 0
};
var ConfigError = class extends Error {
};
function configPath() {
  const fromEnv = process.env.ATLAS_AGENT_CONFIG;
  if (fromEnv) return (0, import_node_path.resolve)(fromEnv);
  const beside = (0, import_node_path.resolve)((0, import_node_path.dirname)(process.argv[1] ?? ""), "config.json");
  if (process.argv[1] && (0, import_node_fs.existsSync)(beside)) return beside;
  return (0, import_node_path.resolve)(process.cwd(), "config.json");
}
function loadConfig() {
  const path = configPath();
  if (!(0, import_node_fs.existsSync)(path)) {
    throw new ConfigError(
      `No config file at ${path}. Copy config.example.json to config.json and fill it in, or set ATLAS_AGENT_CONFIG to its path.`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse((0, import_node_fs.readFileSync)(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`${path} is not valid JSON: ${e.message}`);
  }
  const o = parsed ?? {};
  const str = (k) => {
    const v = o[k];
    if (typeof v !== "string" || !v.trim()) {
      throw new ConfigError(`${path}: "${k}" is required.`);
    }
    return v.trim();
  };
  const num = (k, fallback) => {
    const v = o[k];
    if (v === void 0 || v === null) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ConfigError(`${path}: "${k}" must be a number.`);
    return n;
  };
  const credentials = o.credentials ?? {};
  if (typeof credentials !== "object") {
    throw new ConfigError(`${path}: "credentials" must be an object.`);
  }
  return {
    atlasBaseUrl: str("atlasBaseUrl").replace(/\/+$/, ""),
    deviceToken: str("deviceToken"),
    vendor: str("vendor"),
    credentials,
    pollSeconds: Math.max(30, num("pollSeconds", DEFAULTS.pollSeconds)),
    overlapMinutes: Math.max(0, num("overlapMinutes", DEFAULTS.overlapMinutes)),
    clockOffsetMinutes: num("clockOffsetMinutes", DEFAULTS.clockOffsetMinutes)
  };
}
function redact(cfg) {
  const creds = {};
  for (const [k, v] of Object.entries(cfg.credentials)) {
    if (v === void 0) continue;
    creds[k] = /pass|secret|token|key/i.test(k) ? "***" : v;
  }
  return {
    atlasBaseUrl: cfg.atlasBaseUrl,
    deviceToken: "***",
    vendor: cfg.vendor,
    credentials: creds,
    pollSeconds: cfg.pollSeconds,
    overlapMinutes: cfg.overlapMinutes,
    clockOffsetMinutes: cfg.clockOffsetMinutes
  };
}

// ../atlas-app/src/lib/attendance-capture/agent-protocol.ts
var AGENT_SETTINGS_DEFAULTS = {
  clockOffsetMinutes: 0,
  pollSeconds: 300,
  overlapMinutes: 2880
};
var AGENT_SETTINGS_LIMITS = {
  clockOffsetMinutes: { min: -720, max: 840 },
  pollSeconds: { min: 60, max: 3600 },
  overlapMinutes: { min: 0, max: 10080 }
};
var clampInt = (v, lo, hi, fallback) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};
function cleanAgentSettings(v) {
  const o = v && typeof v === "object" ? v : {};
  const L = AGENT_SETTINGS_LIMITS;
  const D = AGENT_SETTINGS_DEFAULTS;
  return {
    clockOffsetMinutes: clampInt(o.clockOffsetMinutes, L.clockOffsetMinutes.min, L.clockOffsetMinutes.max, D.clockOffsetMinutes),
    pollSeconds: clampInt(o.pollSeconds, L.pollSeconds.min, L.pollSeconds.max, D.pollSeconds),
    overlapMinutes: clampInt(o.overlapMinutes, L.overlapMinutes.min, L.overlapMinutes.max, D.overlapMinutes)
  };
}

// src/version.ts
var AGENT_VERSION = "1.1.0";

// src/atlas.ts
var RevokedError = class extends Error {
};
var TIMEOUT_MS = 6e4;
async function call(cfg, method, body, path = "/api/v1/attendance/capture") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${cfg.atlasBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.deviceToken}`,
        // Atlas records which version checked in, and offers a newer one.
        "x-agent-version": AGENT_VERSION,
        ...body ? { "content-type": "application/json" } : {}
      },
      ...body ? { body: JSON.stringify(body) } : {},
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}
async function serverState(cfg) {
  const res = await call(cfg, "GET");
  if (res.status === 401) {
    throw new RevokedError("This agent is not paired, or has been switched off by the admin.");
  }
  if (!res.ok) throw new Error(`Atlas answered ${res.status} to the pairing check.`);
  const json = await res.json();
  const rel = json.release;
  return {
    vendor: json.vendor ?? null,
    cursor: json.cursor ?? null,
    directionMode: json.directionMode ?? "first_last",
    // An Atlas older than 1.1 sends no settings; keep the local ones then.
    settings: json.settings ? cleanAgentSettings(json.settings) : null,
    release: rel && typeof rel.version === "string" && typeof rel.sha256 === "string" && typeof rel.url === "string" ? { version: rel.version, sha256: rel.sha256, url: rel.url } : null,
    testRequested: json.testRequested === true
  };
}
async function reportStatus(cfg, report) {
  try {
    await call(cfg, "POST", { version: AGENT_VERSION, ...report }, "/api/v1/attendance/capture/status");
  } catch {
  }
}
async function downloadRelease(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 6e4);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Atlas answered ${res.status} for the update`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
async function deliver(cfg, punches, cursor) {
  const res = await call(cfg, "POST", { punches, cursor });
  if (res.status === 401) {
    throw new RevokedError("This agent is not paired, or has been switched off by the admin.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Atlas answered ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

// ../atlas-app/src/lib/shift.ts
var BUSINESS_TZ = "Asia/Kolkata";
var HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

// ../atlas-app/src/lib/attendance-capture/normalise.ts
function parseVendorTime(text, offsetMinutes = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!m) {
    const loose = new Date(text);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  const tzOffsetMs = businessOffsetMs(new Date(asUtc));
  return new Date(asUtc - tzOffsetMs - offsetMinutes * 6e4);
}
function businessOffsetMs(at) {
  const asIfUtc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const asIfLocal = new Date(at.toLocaleString("en-US", { timeZone: BUSINESS_TZ }));
  return asIfLocal.getTime() - asIfUtc.getTime();
}
function directionFromState(state, map = { in: ["0", "i", "in", "checkin", "check-in"], out: ["1", "o", "out", "checkout", "check-out"] }) {
  if (state === null || state === void 0) return null;
  const s = String(state).trim().toLowerCase();
  if (map.in.includes(s)) return "in";
  if (map.out.includes(s)) return "out";
  return null;
}
var SKEW_WARNING_SECONDS = 5 * 60;

// ../atlas-app/src/lib/attendance-capture/adapters/zkteco-biotime.ts
async function authHeader(ctx) {
  const f = ctx.fetch ?? globalThis.fetch;
  const base = (ctx.credentials.baseUrl ?? "").replace(/\/+$/, "");
  if (ctx.credentials.token) {
    return { "Content-Type": "application/json", Authorization: `Token ${ctx.credentials.token}` };
  }
  const res = await f(`${base}/api-token-auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ctx.credentials.username, password: ctx.credentials.password })
  });
  if (!res.ok) throw new Error(`BioTime refused the login (HTTP ${res.status}).`);
  const body = await res.json();
  if (!body.token) throw new Error("BioTime accepted the login but returned no token.");
  return { "Content-Type": "application/json", Authorization: `Token ${body.token}` };
}
function vendorStamp(at, offsetMinutes) {
  const shifted = new Date(at.getTime() + offsetMinutes * 6e4);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(shifted);
  const v = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}:${v("second")}`;
}
var zktecoBioTime = {
  vendor: "zkteco_biotime",
  label: "ZKTeco BioTime 8.0",
  transport: "pull",
  hint: "The BioTime server on the office network - usually http://<pc-ip>:8090. Needs a login; a read-only one is enough.",
  fields: [
    { key: "baseUrl", label: "BioTime address", placeholder: "http://192.168.1.50:8090" },
    { key: "username", label: "Username" },
    { key: "password", label: "Password", secret: true }
  ],
  capabilities: { health: true, employees: true },
  async fetchPunches(ctx) {
    const f = ctx.fetch ?? globalThis.fetch;
    const base = (ctx.credentials.baseUrl ?? "").replace(/\/+$/, "");
    const headers = await authHeader(ctx);
    const from = ctx.cursor ? new Date(Date.parse(ctx.cursor) - ctx.overlapMinutes * 6e4) : new Date(Date.now() - 7 * 864e5);
    const to = new Date(Date.now() + 6e4);
    const params = new URLSearchParams({
      start_time: vendorStamp(from, ctx.clockOffsetMinutes),
      end_time: vendorStamp(to, ctx.clockOffsetMinutes),
      page_size: "500"
    });
    const res = await f(`${base}/iclock/api/transactions/?${params}`, { headers });
    if (!res.ok) throw new Error(`BioTime would not give us punches (HTTP ${res.status}).`);
    const body = await res.json();
    const rows = body.data ?? [];
    const punches = [];
    let newest = ctx.cursor ? new Date(ctx.cursor) : from;
    for (const r of rows) {
      if (!r.emp_code || !r.punch_time) continue;
      const at = parseVendorTime(r.punch_time, ctx.clockOffsetMinutes);
      if (!at) continue;
      if (at > newest) newest = at;
      punches.push({
        employeeCode: String(r.emp_code).trim(),
        atUtc: at,
        // 0 = check-in, 1 = check-out by ZK convention. Trusted only when the
        // device is set to `from_state`; most sites are not.
        direction: directionFromState(r.punch_state),
        verifyType: r.verify_type != null ? String(r.verify_type) : null,
        terminalRef: r.terminal_sn ? String(r.terminal_sn) : null,
        externalId: r.id != null ? String(r.id) : null,
        raw: r
      });
    }
    return {
      punches,
      nextCursor: newest.toISOString(),
      hasMore: Boolean(body.next)
    };
  },
  /** §5: `GET /iclock/api/terminals/` - device health, free. */
  async listTerminals(ctx) {
    const f = ctx.fetch ?? globalThis.fetch;
    const base = (ctx.credentials.baseUrl ?? "").replace(/\/+$/, "");
    const res = await f(`${base}/iclock/api/terminals/`, { headers: await authHeader(ctx) });
    if (!res.ok) throw new Error(`BioTime would not list its readers (HTTP ${res.status}).`);
    const body = await res.json();
    return (body.data ?? []).map((t) => ({
      ref: String(t.sn ?? ""),
      name: t.alias ?? null,
      online: t.state === 1,
      lastSeenAt: t.last_activity ? parseVendorTime(t.last_activity, ctx.clockOffsetMinutes) : null,
      punchCount: t.transaction_count ?? null
    }));
  },
  /** §6: `GET /personnel/api/employees/` - the mapping screen's left column. */
  async listEmployees(ctx) {
    const f = ctx.fetch ?? globalThis.fetch;
    const base = (ctx.credentials.baseUrl ?? "").replace(/\/+$/, "");
    const res = await f(`${base}/personnel/api/employees/?page_size=500`, { headers: await authHeader(ctx) });
    if (!res.ok) throw new Error(`BioTime would not list its people (HTTP ${res.status}).`);
    const body = await res.json();
    return (body.data ?? []).filter((e) => e.emp_code).map((e) => ({
      employeeCode: String(e.emp_code),
      name: [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || null,
      department: e.dept_name ?? null
    }));
  }
};

// ../atlas-app/src/lib/attendance-capture/adapters/hikvision-isapi.ts
var DIRECTION_MAP = {
  in: ["1", "checkin", "entry", "in", "breakout"],
  out: ["2", "checkout", "exit", "out", "breakin"]
};
var hikvisionIsapi = {
  vendor: "hikvision_isapi",
  label: "Hikvision (ISAPI event push)",
  transport: "push",
  hint: "The device posts each punch to a web address you set on it. Nothing to poll, and nothing to install on the office network.",
  fields: [
    { key: "sharedSecret", label: "Shared secret (optional)", secret: true, placeholder: "Leave blank if the device cannot send one" }
  ],
  capabilities: { health: false, employees: false },
  parsePush(body, ctx) {
    if (!body || typeof body !== "object") return [];
    const items = Array.isArray(body) ? body : [body];
    const out = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const env = item;
      const ev = env.AccessControllerEvent ?? env;
      const code = String(ev.employeeNoString ?? ev.employeeNo ?? "").trim();
      if (!code) continue;
      const stamp2 = ev.time ?? ev.dateTime ?? env.dateTime;
      if (!stamp2) continue;
      const at = parseVendorTime(String(stamp2), ctx.clockOffsetMinutes);
      if (!at) continue;
      out.push({
        employeeCode: code,
        atUtc: at,
        direction: directionFromState(ev.attendanceStatus, DIRECTION_MAP),
        verifyType: ev.currentVerifyMode ?? null,
        terminalRef: env.macAddress ?? env.ipAddress ?? (ev.doorNo != null ? `door-${ev.doorNo}` : null),
        // `serialNo` is per-device and monotonic where present, which makes it
        // a sound natural key. Where it is absent, ingest falls back to
        // device + person + second.
        externalId: ev.serialNo != null ? String(ev.serialNo) : null,
        raw: item
      });
    }
    return out;
  }
};

// ../atlas-app/src/lib/attendance-capture/adapters/csv-file.ts
var DEFAULT_CSV_MAPPING = {
  employeeCode: "employee_code",
  dateTime: "punch_time",
  direction: "punch_state",
  terminal: "terminal_sn"
};
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  return rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
}
var norm = (s) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");
function punchesFromRows(rows, mapping, clockOffsetMinutes = 0) {
  const out = [];
  for (const r of rows) {
    const code = (r[norm(mapping.employeeCode)] ?? "").trim();
    if (!code) continue;
    const stamp2 = mapping.date && mapping.time ? `${r[norm(mapping.date)] ?? ""} ${r[norm(mapping.time)] ?? ""}`.trim() : (r[norm(mapping.dateTime)] ?? "").trim();
    if (!stamp2) continue;
    const at = parseVendorTime(stamp2, clockOffsetMinutes);
    if (!at) continue;
    out.push({
      employeeCode: code,
      atUtc: at,
      direction: mapping.direction ? directionFromState(r[norm(mapping.direction)]) : null,
      terminalRef: mapping.terminal ? r[norm(mapping.terminal)] || null : null,
      externalId: mapping.externalId ? r[norm(mapping.externalId)] || null : null,
      raw: r
    });
  }
  return out;
}
var csvFile = {
  vendor: "csv_file",
  label: "Daily CSV / Excel export",
  transport: "file",
  hint: "For vendors who will not give an API but will send a daily file. Usually the quickest route of all.",
  fields: [
    { key: "employeeCodeColumn", label: "Employee code column", placeholder: "employee_code" },
    { key: "dateTimeColumn", label: "Date and time column", placeholder: "punch_time" },
    { key: "directionColumn", label: "In/out column (optional)", placeholder: "punch_state" }
  ],
  capabilities: { health: false, employees: false },
  /**
   * Reads whatever the agent last dropped. `ctx.credentials.content` is the
   * file's text - the agent reads it from the watched folder or the mailbox,
   * because a server on Vercel has neither.
   */
  async fetchPunches(ctx) {
    const content = ctx.credentials.content ?? "";
    if (!content.trim()) return { punches: [], nextCursor: ctx.cursor, hasMore: false };
    const mapping = {
      employeeCode: ctx.credentials.employeeCodeColumn || DEFAULT_CSV_MAPPING.employeeCode,
      dateTime: ctx.credentials.dateTimeColumn || DEFAULT_CSV_MAPPING.dateTime,
      direction: ctx.credentials.directionColumn || DEFAULT_CSV_MAPPING.direction,
      terminal: ctx.credentials.terminalColumn || DEFAULT_CSV_MAPPING.terminal
    };
    const punches = punchesFromRows(parseCsv(content), mapping, ctx.clockOffsetMinutes);
    const newest = punches.reduce(
      (n, p) => n === null || p.atUtc > n ? p.atUtc : n,
      null
    );
    return {
      punches,
      nextCursor: newest ? newest.toISOString() : ctx.cursor,
      hasMore: false
    };
  }
};

// ../atlas-app/src/lib/attendance-capture/adapters/selfie.ts
var selfie = {
  vendor: "selfie",
  label: "Phone selfie + location",
  transport: "device",
  hint: "Staff clock in on their phone; it takes a photo and checks they are at the office or the job. No machine, no vendor, no face data stored.",
  fields: [],
  capabilities: { health: false, employees: false },
  /**
   * The phone posts one punch at a time through the existing paired-device
   * route, so this only has to shape what arrived. The geofence and the
   * mock-location check have already run in `server/attendance-mobile.ts` -
   * they are not repeated here, because two implementations of a location rule
   * is how the two drift apart.
   */
  parsePush(body) {
    if (!body || typeof body !== "object") return [];
    const o = body;
    const code = String(o.employeeCode ?? o.userCode ?? "").trim();
    const at = typeof o.at === "number" ? new Date(o.at) : typeof o.at === "string" ? new Date(o.at) : null;
    if (!code || !at || Number.isNaN(at.getTime())) return [];
    const dir = o.direction === "out" ? "out" : o.direction === "in" ? "in" : null;
    return [{
      employeeCode: code,
      atUtc: at,
      direction: dir,
      verifyType: "selfie",
      terminalRef: typeof o.deviceId === "string" ? o.deviceId : null,
      // The phone's own queue id, so a punch sent twice after a flaky
      // connection is recognised rather than counted twice.
      externalId: typeof o.clientId === "string" ? o.clientId : null,
      raw: body
    }];
  }
};

// ../atlas-app/src/lib/attendance-capture/registry.ts
var ADAPTERS = [
  zktecoBioTime,
  hikvisionIsapi,
  csvFile,
  selfie
];
var BY_VENDOR = new Map(ADAPTERS.map((a) => [a.vendor, a]));
var UnknownVendorError = class extends Error {
  constructor(vendor) {
    super(
      `No adapter for "${vendor}". Add one under lib/attendance-capture/adapters and list it in the registry.`
    );
  }
};
function requireAdapter(vendor) {
  const a = BY_VENDOR.get(vendor);
  if (!a) throw new UnknownVendorError(vendor);
  return a;
}

// src/log.ts
var stamp = () => (/* @__PURE__ */ new Date()).toISOString();
var log = {
  info: (msg) => console.log(`${stamp()}  ${msg}`),
  warn: (msg) => console.warn(`${stamp()}  WARN  ${msg}`),
  error: (msg, err) => {
    const detail = err instanceof Error ? `${err.message}` : err ? String(err) : "";
    console.error(`${stamp()}  ERROR ${msg}${detail ? ` - ${detail}` : ""}`);
  }
};

// src/poll.ts
var MAX_PAGES = 50;
function effectiveConfig(cfg, state) {
  return state.settings ? { ...cfg, ...state.settings } : cfg;
}
async function runCycle(cfg0, given) {
  const adapter = requireAdapter(cfg0.vendor);
  if (!adapter.fetchPunches) {
    throw new Error(
      `The ${adapter.label} adapter does not poll - it is a "${adapter.transport}" adapter. Only pull vendors need this agent.`
    );
  }
  const state = given ?? await serverState(cfg0);
  const cfg = effectiveConfig(cfg0, state);
  if (state.vendor && state.vendor !== cfg.vendor) {
    throw new Error(
      `Atlas has this device set to "${state.vendor}" but this agent is configured for "${cfg.vendor}". Fix one of them before punches are attributed wrongly.`
    );
  }
  let cursor = state.cursor;
  const totals = { pages: 0, received: 0, stored: 0, applied: 0, unmapped: 0 };
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await adapter.fetchPunches({
      credentials: cfg.credentials,
      clockOffsetMinutes: cfg.clockOffsetMinutes,
      cursor,
      overlapMinutes: cfg.overlapMinutes
    });
    if (batch.punches.length === 0) {
      if (batch.nextCursor && batch.nextCursor !== cursor) {
        await deliver(cfg, [], batch.nextCursor);
        cursor = batch.nextCursor;
      }
      if (!batch.hasMore) break;
      continue;
    }
    const summary = await deliver(cfg, batch.punches, batch.nextCursor);
    cursor = batch.nextCursor ?? cursor;
    totals.pages++;
    totals.received += summary.received;
    totals.stored += summary.stored;
    totals.applied += summary.applied;
    totals.unmapped += summary.unmapped;
    log.info(
      `page ${page + 1}: ${summary.received} received, ${summary.stored} new, ${summary.applied} applied, ${summary.duplicates} already had, ${summary.unmapped} unmapped, ${summary.unusable} unusable`
    );
    for (const e of summary.errors) log.warn(`Atlas: ${e}`);
    if (!batch.hasMore) break;
    if (page === MAX_PAGES - 1) {
      log.warn(`stopped at ${MAX_PAGES} pages; the rest follows on the next poll`);
    }
  }
  if (totals.unmapped > 0) {
    log.warn(
      `${totals.unmapped} punch(es) are waiting for an employee code to be mapped. Map them in Atlas: Attendance devices > unmapped codes. Nothing is lost until then.`
    );
  }
  return totals;
}
async function runTest(cfg0, state) {
  const cfg = effectiveConfig(cfg0, state);
  const adapter = requireAdapter(cfg.vendor);
  const ctx = {
    credentials: cfg.credentials,
    clockOffsetMinutes: cfg.clockOffsetMinutes,
    cursor: null,
    overlapMinutes: 0
  };
  const result = {
    ok: false,
    vendorReachable: false,
    punchesLast7Days: null,
    newestPunchAt: null,
    terminals: [],
    error: null
  };
  try {
    if (!adapter.fetchPunches) throw new Error(`The ${adapter.label} adapter does not poll.`);
    const batch = await adapter.fetchPunches(ctx);
    result.vendorReachable = true;
    result.punchesLast7Days = batch.punches.length;
    const newest = batch.punches.reduce((m, p) => !m || p.atUtc > m ? p.atUtc : m, null);
    result.newestPunchAt = newest?.toISOString() ?? null;
    if (adapter.listTerminals) {
      const terms = await adapter.listTerminals(ctx).catch(() => []);
      result.terminals = terms.slice(0, 50).map((t) => ({
        serial: t.ref,
        alias: t.name ?? null,
        lastSeenAt: t.lastSeenAt ? t.lastSeenAt.toISOString() : null
      }));
    }
    result.ok = true;
    if (batch.punches.length === 0) {
      result.error = "BioTime holds no punches for the last 7 days - check the terminal is sending to BioTime.";
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

// src/updater.ts
var import_node_crypto = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var UPDATE_EXIT_CODE = 75;
function canSelfUpdate() {
  return process.env.ATLAS_AGENT_LAUNCHER === "1" && /agent\.js$/i.test(process.argv[1] ?? "");
}
async function stageUpdate(release) {
  if (!canSelfUpdate()) {
    log.info(`Atlas offers connector ${release.version}; not under the launcher, so not updating`);
    return false;
  }
  log.info(`Atlas offers connector ${release.version} - downloading`);
  const body = await downloadRelease(release.url);
  const got = (0, import_node_crypto.createHash)("sha256").update(body).digest("hex");
  if (got.toLowerCase() !== release.sha256.toLowerCase()) {
    throw new Error(`update ${release.version} refused: its fingerprint does not match (got ${got.slice(0, 12)}...)`);
  }
  const dir = (0, import_node_path2.dirname)(process.argv[1]);
  const tmp = (0, import_node_path2.join)(dir, "agent.next.js.part");
  (0, import_node_fs2.writeFileSync)(tmp, body);
  (0, import_node_fs2.renameSync)(tmp, (0, import_node_path2.join)(dir, "agent.next.js"));
  log.info(`connector ${release.version} verified and staged; restarting into it`);
  return true;
}

// src/index.ts
var BACKOFF_MIN_MS = 3e4;
var BACKOFF_MAX_MS = 15 * 6e4;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var stopping = false;
async function loop(cfg) {
  let backoff = BACKOFF_MIN_MS;
  while (!stopping) {
    let state = null;
    let wait = cfg.pollSeconds * 1e3;
    try {
      state = await serverState(cfg);
      wait = effectiveConfig(cfg, state).pollSeconds * 1e3;
      if (state.testRequested) {
        log.info("Atlas asked for a test");
        const test = await runTest(cfg, state);
        log.info(`test: ${test.ok ? "passed" : "failed"}${test.error ? ` - ${test.error}` : ""}`);
        await reportStatus(cfg, {
          at: (/* @__PURE__ */ new Date()).toISOString(),
          ok: test.ok,
          received: 0,
          stored: 0,
          applied: 0,
          unmapped: 0,
          error: test.ok ? null : test.error,
          test
        });
      }
      const t = Date.now();
      const r = await runCycle(cfg, state);
      const secs = ((Date.now() - t) / 1e3).toFixed(1);
      if (r.received === 0) {
        log.info(`nothing new (${secs}s)`);
      } else {
        log.info(
          `done: ${r.received} received, ${r.stored} new, ${r.applied} applied over ${r.pages} page(s) in ${secs}s`
        );
      }
      await reportStatus(cfg, {
        at: (/* @__PURE__ */ new Date()).toISOString(),
        ok: true,
        received: r.received,
        stored: r.stored,
        applied: r.applied,
        unmapped: r.unmapped,
        error: null
      });
      backoff = BACKOFF_MIN_MS;
    } catch (err) {
      if (err instanceof RevokedError) {
        log.error("not paired", err);
        await sleep(BACKOFF_MAX_MS);
        continue;
      }
      log.error("poll failed; will retry", err);
      await reportStatus(cfg, {
        at: (/* @__PURE__ */ new Date()).toISOString(),
        ok: false,
        received: 0,
        stored: 0,
        applied: 0,
        unmapped: 0,
        error: err instanceof Error ? err.message : String(err)
      });
      wait = backoff;
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
    if (state?.release) {
      try {
        if (await stageUpdate(state.release)) {
          stopping = true;
          process.exitCode = UPDATE_EXIT_CODE;
          return;
        }
      } catch (err) {
        log.error("update failed; staying on this version", err);
      }
    }
    await sleep(wait);
  }
}
async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  log.info(`Atlas attendance connector ${AGENT_VERSION} starting: ${JSON.stringify(redact(cfg))}`);
  if (process.argv.includes("--once")) {
    try {
      const r = await runCycle(cfg);
      log.info(`one cycle: ${r.received} received, ${r.stored} new, ${r.applied} applied`);
      await reportStatus(cfg, {
        at: (/* @__PURE__ */ new Date()).toISOString(),
        ok: true,
        received: r.received,
        stored: r.stored,
        applied: r.applied,
        unmapped: r.unmapped,
        error: null
      });
    } catch (err) {
      log.error("one cycle failed", err);
      if (!(err instanceof RevokedError)) {
        await reportStatus(cfg, {
          at: (/* @__PURE__ */ new Date()).toISOString(),
          ok: false,
          received: 0,
          stored: 0,
          applied: 0,
          unmapped: 0,
          error: err instanceof Error ? err.message : String(err)
        });
      }
      process.exitCode = 1;
    }
    return;
  }
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (stopping) return;
      stopping = true;
      log.info(`${sig} - finishing the current poll, then stopping`);
    });
  }
  await loop(cfg);
  log.info("stopped");
}
void main().catch((err) => {
  log.error("fatal", err);
  process.exitCode = 1;
});

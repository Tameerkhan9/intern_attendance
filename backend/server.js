const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const tls = require("tls");
const express = require("express");
const { createStorage } = require("./storage");

const ROOT_DIR = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const unquotedValue = rawValue.replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = unquotedValue;
    }
  });
};

loadEnvFile(ENV_PATH);

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";
const IS_SERVERLESS = Boolean(
  process.env.VERCEL
  || process.env.VERCEL_ENV
  || process.env.VERCEL_URL
  || process.env.AWS_REGION
  || process.env.LAMBDA_TASK_ROOT
);
const DATA_DIR = process.env.DATA_DIR || ((IS_SERVERLESS || DATABASE_URL)
  ? path.join("/tmp", "inter_attendance_data")
  : path.join(ROOT_DIR, "data"));
const DB_PATH = path.join(DATA_DIR, "attendance.db");
const VALID_STATUSES = ["Present", "Late", "Absent", "Leave"];
const VALID_ATTENDANCE_SESSIONS = ["morning", "evening"];
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const PASSWORD_CODE_EMAIL = process.env.PASSWORD_CODE_EMAIL || "networkcorvitpwr@gmail.com";
const GMAIL_SENDER = process.env.GMAIL_SENDER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";

if (!DATABASE_URL) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const hashPassword = (password) => crypto
  .createHash("sha256")
  .update(password)
  .digest("hex");

const getAttendanceSession = (value) => (
  VALID_ATTENDANCE_SESSIONS.includes(value) ? value : "morning"
);

const storagePromise = createStorage({
  dbPath: DB_PATH,
  dataDir: DATA_DIR,
  adminUsername: ADMIN_USERNAME,
  adminPasswordHash: hashPassword(ADMIN_PASSWORD)
});

app.use(express.json());
app.use(express.static(FRONTEND_DIR));

const toDateKey = (date = new Date()) => date.toISOString().slice(0, 10);
const getStatus = (statusOverride) => statusOverride || "Absent";

const toPublicUser = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  displayName: user.displayName,
  internId: user.internId || null
});

const mapIntern = (row) => ({
  id: row.id,
  name: row.name,
  team: row.team,
  attendanceDate: row.attendanceDate || null,
  attendanceSession: row.attendanceSession || "morning",
  status: getStatus(row.statusOverride || "")
});

const escapeCsvValue = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
};

const toCsv = (rows) => rows
  .map((row) => row.map(escapeCsvValue).join(","))
  .join("\r\n");

const createPasswordCode = () => String(crypto.randomInt(100000, 1000000));

const smtpRead = (socket) => new Promise((resolve, reject) => {
  let buffer = "";

  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/).filter(Boolean);
    const lastLine = lines.at(-1) || "";

    if (/^\d{3} /.test(lastLine)) {
      socket.off("data", onData);
      resolve(buffer);
    }
  };

  socket.on("data", onData);
  socket.once("error", reject);
});

const smtpCommand = async (socket, command, expectedCodes) => {
  socket.write(`${command}\r\n`);
  const reply = await smtpRead(socket);
  const code = reply.slice(0, 3);

  if (!expectedCodes.includes(code)) {
    throw new Error("Gmail rejected the verification email.");
  }
};

const sendRecoveryEmail = async (subject, body) => {
  if (!GMAIL_SENDER || !GMAIL_APP_PASSWORD) {
    throw new Error("Gmail sender is not configured.");
  }

  const socket = tls.connect(465, "smtp.gmail.com", { servername: "smtp.gmail.com" });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  await smtpRead(socket);

  const auth = Buffer.from(`\u0000${GMAIL_SENDER}\u0000${GMAIL_APP_PASSWORD}`).toString("base64");
  const message = [
    `From: Attendance Portal <${GMAIL_SENDER}>`,
    `To: ${PASSWORD_CODE_EMAIL}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\r\n");

  await smtpCommand(socket, "EHLO attendance-portal.local", ["250"]);
  await smtpCommand(socket, `AUTH PLAIN ${auth}`, ["235"]);
  await smtpCommand(socket, `MAIL FROM:<${GMAIL_SENDER}>`, ["250"]);
  await smtpCommand(socket, `RCPT TO:<${PASSWORD_CODE_EMAIL}>`, ["250", "251"]);
  await smtpCommand(socket, "DATA", ["354"]);
  await smtpCommand(socket, `${message}\r\n.`, ["250"]);
  await smtpCommand(socket, "QUIT", ["221"]);
  socket.end();
};

const sendPasswordCodeEmail = (code) => sendRecoveryEmail(
  "Attendance portal password code",
  `Your password reset code is ${code}.\r\nThis code expires in 10 minutes.`
);

const sendUsernameEmail = () => sendRecoveryEmail(
  "Attendance portal username",
  `Your attendance portal username is ${ADMIN_USERNAME}.`
);

const isPasswordResetConfigured = () => Boolean(GMAIL_SENDER && GMAIL_APP_PASSWORD);

const buildSummary = (records) => records.reduce((summary, record) => {
  summary.totalInterns += 1;

  if (record.status === "Present") {
    summary.present += 1;
  } else if (record.status === "Late") {
    summary.late += 1;
  } else if (record.status === "Leave") {
    summary.leave += 1;
  } else {
    summary.absent += 1;
  }

  return summary;
}, {
  totalInterns: 0,
  present: 0,
  late: 0,
  leave: 0,
  absent: 0
});

const getSessionWeight = (status) => {
  if (status === "Present" || status === "Late") {
    return 1;
  }

  if (status === "Leave") {
    return 0.5;
  }

  return 0;
};

const buildCombinedDailyStatus = (morningStatus, eveningStatus) => {
  const morning = getStatus(morningStatus || "");
  const evening = getStatus(eveningStatus || "");

  if (!morningStatus && !eveningStatus) {
    return null;
  }

  if (morning === "Present" && evening === "Present") {
    return "Present";
  }

  if (morning === "Late" && evening === "Late") {
    return "Late";
  }

  if (morning === "Leave" && evening === "Leave") {
    return "Leave";
  }

  if (
    (morning === "Present" && evening === "Absent")
    || (morning === "Absent" && evening === "Present")
    || (morning === "Late" && evening === "Absent")
    || (morning === "Absent" && evening === "Late")
    || (morning === "Present" && evening === "Leave")
    || (morning === "Leave" && evening === "Present")
    || (morning === "Late" && evening === "Leave")
    || (morning === "Leave" && evening === "Late")
  ) {
    return "Half Day";
  }

  const totalWeight = getSessionWeight(morning) + getSessionWeight(evening);

  if (totalWeight >= 2) {
    return morning === "Late" || evening === "Late" ? "Late" : "Present";
  }

  if (totalWeight >= 1) {
    return "Half Day";
  }

  if (morning === "Leave" || evening === "Leave") {
    return "Leave";
  }

  return "Absent";
};

const buildPeriodRange = (period, value) => {
  if (period === "daily") {
    const target = value || toDateKey();
    return { start: target, end: target, label: target };
  }

  if (period === "weekly") {
    const base = value ? new Date(`${value}T00:00:00`) : new Date();
    const dayOfWeek = base.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const start = new Date(base);
    start.setDate(base.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      start: toDateKey(start),
      end: toDateKey(end),
      label: `${toDateKey(start)} to ${toDateKey(end)}`
    };
  }

  if (period === "monthly") {
    const base = value ? new Date(`${value}-01T00:00:00`) : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return {
      start: toDateKey(start),
      end: toDateKey(end),
      label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`
    };
  }

  if (period === "custom") {
    const [rawStart = "", rawEnd = ""] = String(value).split(",");
    const start = rawStart || toDateKey();
    const end = rawEnd || start;
    const orderedStart = start <= end ? start : end;
    const orderedEnd = start <= end ? end : start;
    return {
      start: orderedStart,
      end: orderedEnd,
      label: `${orderedStart} to ${orderedEnd}`
    };
  }

  const base = value ? new Date(`${value}-01-01T00:00:00`) : new Date();
  const start = new Date(base.getFullYear(), 0, 1);
  const end = new Date(base.getFullYear(), 11, 31);
  return {
    start: toDateKey(start),
    end: toDateKey(end),
    label: String(start.getFullYear())
  };
};

const requireAuth = async (request, response, next) => {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return response.status(401).json({ error: "Please log in first." });
  }

  const storage = await storagePromise;
  const user = await storage.getSessionUser(token);

  if (!user) {
    await storage.deleteSession(token);
    return response.status(401).json({ error: "Session expired." });
  }

  request.user = toPublicUser(user);
  request.token = token;
  return next();
};

const requireRole = (role) => (request, response, next) => {
  if (request.user.role !== role) {
    return response.status(403).json({ error: "You do not have access to this area." });
  }

  return next();
};

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/version", (_request, response) => {
  response.json({ version: "security-export-2026-06-06" });
});

app.get("/api/auth/password-reset-status", (_request, response) => {
  response.json({
    configured: isPasswordResetConfigured(),
    email: PASSWORD_CODE_EMAIL
  });
});

app.post("/api/auth/login", async (request, response) => {
  const username = request.body.username?.trim().toLowerCase();
  const password = request.body.password || "";
  const storage = await storagePromise;
  const user = username ? await storage.findUserByUsername(username) : null;

  if (!user || user.role !== "admin" || user.passwordHash !== hashPassword(password)) {
    return response.status(401).json({ error: "Invalid username or password." });
  }

  const token = crypto.randomUUID();
  await storage.createSession(token, user.id);

  return response.json({
    token,
    user: toPublicUser(user)
  });
});

app.post("/api/auth/logout", requireAuth, async (request, response) => {
  const storage = await storagePromise;
  await storage.deleteSession(request.token);
  response.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  response.json({ user: request.user });
});

app.post("/api/auth/password-reset-code", async (_request, response) => {
  if (!isPasswordResetConfigured()) {
    return response.status(503).json({
      error: "Password reset email is not configured. Ask the admin to set GMAIL_SENDER and GMAIL_APP_PASSWORD."
    });
  }

  const storage = await storagePromise;
  const user = await storage.findUserByUsername(ADMIN_USERNAME);

  if (!user) {
    return response.status(404).json({ error: "Admin account was not found." });
  }

  const code = createPasswordCode();
  await storage.savePasswordCode(user.id, code, Date.now() + 10 * 60 * 1000);

  try {
    await sendPasswordCodeEmail(code);
    response.json({ ok: true, email: PASSWORD_CODE_EMAIL });
  } catch (error) {
    await storage.deletePasswordCode(user.id);
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/reset-password", async (request, response) => {
  const newPassword = request.body.newPassword || "";
  const verificationCode = String(request.body.verificationCode || "").trim();
  const storage = await storagePromise;
  const admin = await storage.findUserByUsername(ADMIN_USERNAME);
  const user = admin ? await storage.findUserWithPasswordById(admin.id) : null;
  const savedCode = user ? await storage.getPasswordCode(user.id) : null;

  if (!user) {
    return response.status(404).json({ error: "Admin account was not found." });
  }

  if (!savedCode || savedCode.expiresAt < Date.now() || savedCode.code !== verificationCode) {
    return response.status(400).json({ error: "Enter the valid Gmail verification code." });
  }

  if (newPassword.length < 8) {
    return response.status(400).json({ error: "New password must be at least 8 characters." });
  }

  if (user.passwordHash === hashPassword(newPassword)) {
    return response.status(400).json({ error: "New password must be different." });
  }

  await storage.updateUserPassword(hashPassword(newPassword), user.id);
  await storage.deletePasswordCode(user.id);
  response.json({ ok: true });
});

app.get("/api/admin/interns", requireAuth, requireRole("admin"), async (request, response) => {
  const date = request.query.date || toDateKey();
  const attendanceSession = getAttendanceSession(request.query.session);
  const storage = await storagePromise;
  const interns = await storage.listInterns(date, attendanceSession);

  response.json({
    date,
    session: attendanceSession,
    interns,
    summary: buildSummary(interns)
  });
});

app.post("/api/admin/interns", requireAuth, requireRole("admin"), async (request, response) => {
  const name = request.body.name?.trim();
  const team = request.body.team?.trim();

  if (!name || !team) {
    return response.status(400).json({ error: "Name and department are required." });
  }

  const intern = {
    id: crypto.randomUUID(),
    name,
    team
  };

  const storage = await storagePromise;
  await storage.insertIntern(intern);

  return response.status(201).json(intern);
});

app.delete("/api/admin/interns/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const storage = await storagePromise;
  const intern = await storage.findInternWithCreatedAt(request.params.id);

  if (!intern) {
    return response.status(404).json({ error: "Intern not found." });
  }

  const attendanceRecords = await storage.listAttendanceForIntern(request.params.id);
  await storage.deleteIntern(request.params.id);

  return response.json({
    deletedIntern: {
      intern,
      attendanceRecords
    }
  });
});

app.post("/api/admin/interns/restore", requireAuth, requireRole("admin"), async (request, response) => {
  const intern = request.body.intern;
  const attendanceRecords = Array.isArray(request.body.attendanceRecords)
    ? request.body.attendanceRecords
    : [];

  if (!intern?.id || !intern?.name || !intern?.team || !intern?.createdAt) {
    return response.status(400).json({ error: "Restore data is incomplete." });
  }

  const storage = await storagePromise;
  if (await storage.findIntern(intern.id)) {
    return response.status(409).json({ error: "Intern already exists." });
  }

  await storage.restoreIntern(
    intern,
    attendanceRecords.map((record) => ({
      ...record,
      attendanceSession: getAttendanceSession(record.attendanceSession)
    }))
  );

  return response.status(201).json(intern);
});

app.post("/api/admin/attendance/status", requireAuth, requireRole("admin"), async (request, response) => {
  const internId = request.body.internId;
  const attendanceDate = request.body.attendanceDate || toDateKey();
  const attendanceSession = getAttendanceSession(request.body.attendanceSession);
  const status = request.body.status;
  const storage = await storagePromise;
  const existing = await storage.findAttendanceRecord(internId, attendanceDate, attendanceSession);

  if (!VALID_STATUSES.includes(status)) {
    return response.status(400).json({ error: "Invalid attendance status." });
  }

  if (!await storage.findIntern(internId)) {
    return response.status(404).json({ error: "Intern not found." });
  }

  if (!existing) {
    await storage.insertAttendance({
      internId,
      attendanceDate,
      attendanceSession,
      statusOverride: status
    });
  } else {
    await storage.updateAttendance({
      internId,
      attendanceDate,
      attendanceSession,
      statusOverride: status
    });
  }

  return response.json({ ok: true });
});

app.post("/api/admin/attendance/reset-today", requireAuth, requireRole("admin"), async (request, response) => {
  const attendanceDate = request.body.attendanceDate || toDateKey();
  const attendanceSession = getAttendanceSession(request.body.attendanceSession);
  const storage = await storagePromise;
  await storage.resetAttendance(attendanceDate, attendanceSession);
  response.json({ ok: true });
});

app.get("/api/admin/export-attendance", requireAuth, requireRole("admin"), async (request, response) => {
  const date = request.query.date || toDateKey();
  const selectedSession = getAttendanceSession(request.query.session);
  const otherSession = selectedSession === "evening" ? "morning" : "evening";
  const selectedHeader = `${selectedSession[0].toUpperCase()}${selectedSession.slice(1)} Status`;
  const otherHeader = `${otherSession[0].toUpperCase()}${otherSession.slice(1)} Status`;
  const storage = await storagePromise;
  const interns = await storage.listDailyAttendance(date);
  const rows = [
    ["Date", "Selected Session", "Intern", "Department", selectedHeader, otherHeader],
    ...interns.map((intern) => {
      const morningStatus = getStatus(intern.morningStatus || "");
      const eveningStatus = getStatus(intern.eveningStatus || "");

      return [
        date,
        selectedSession,
        intern.name,
        intern.team,
        selectedSession === "evening" ? eveningStatus : morningStatus,
        selectedSession === "evening" ? morningStatus : eveningStatus
      ];
    })
  ];
  const csv = `${toCsv(rows)}\r\n`;

  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="attendance-${date}-${selectedSession}.csv"`);
  response.send(csv);
});

app.get("/api/admin/reports/summary", requireAuth, requireRole("admin"), async (request, response) => {
  const period = request.query.period || "daily";
  const value = request.query.value || "";
  const range = buildPeriodRange(period, value);
  const storage = await storagePromise;
  const report = await storage.listCombinedReport(range.start, range.end);
  const activeInterns = await storage.activeInternCount();

  response.json({
    period,
    session: "combined",
    label: range.label,
    range,
    summary: {
      ...report.summary,
      activeInterns
    },
    records: report.records,
    detailedRecords: report.detailedRecords
  });
});

app.use((_request, response) => {
  response.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Intern attendance portal running on http://localhost:${PORT}`);
  });
}

module.exports = app;

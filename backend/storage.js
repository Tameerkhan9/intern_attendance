const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const postgres = require("postgres");

const seedInterns = [
  { id: crypto.randomUUID(), name: "Ava Thompson", team: "Engineering" },
  { id: crypto.randomUUID(), name: "Liam Nguyen", team: "Design" },
  { id: crypto.randomUUID(), name: "Mia Patel", team: "Operations" }
];

const getStatus = (value) => value || "Absent";

const buildCombinedDailyStatus = (morningStatus, eveningStatus) => {
  const morning = getStatus(morningStatus || "");
  const evening = getStatus(eveningStatus || "");

  if (!morningStatus && !eveningStatus) {
    return null;
  }

  if (morning === "Present" && evening === "Present") return "Present";
  if (morning === "Late" && evening === "Late") return "Late";
  if (morning === "Leave" && evening === "Leave") return "Leave";

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

  const getSessionWeight = (status) => {
    if (status === "Present" || status === "Late") return 1;
    if (status === "Leave") return 0.5;
    return 0;
  };

  const totalWeight = getSessionWeight(morning) + getSessionWeight(evening);
  if (totalWeight >= 2) return morning === "Late" || evening === "Late" ? "Late" : "Present";
  if (totalWeight >= 1) return "Half Day";
  if (morning === "Leave" || evening === "Leave") return "Leave";
  return "Absent";
};

const mapInternRow = (row) => ({
  id: row.id,
  name: row.name,
  team: row.team,
  attendanceDate: row.attendanceDate || null,
  attendanceSession: row.attendanceSession || "morning",
  status: getStatus(row.statusOverride || "")
});

const createPostgresStorage = async ({ connectionString, adminUsername, adminPasswordHash }) => {
  const sql = postgres(connectionString, {
    ssl: "require",
    max: 1,
    idle_timeout: 20,
    connect_timeout: 20
  });

  await sql`
    CREATE TABLE IF NOT EXISTS interns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id BIGSERIAL PRIMARY KEY,
      intern_id TEXT NOT NULL REFERENCES interns(id) ON DELETE CASCADE,
      attendance_date TEXT NOT NULL,
      attendance_session TEXT NOT NULL DEFAULT 'morning',
      status_override TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(intern_id, attendance_date, attendance_session)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      intern_id TEXT REFERENCES interns(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_codes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
  `;

  const adminRows = await sql`SELECT id FROM users WHERE username = ${adminUsername}`;
  if (!adminRows.length) {
    await sql`
      INSERT INTO users (id, username, password_hash, role, display_name, intern_id)
      VALUES (${crypto.randomUUID()}, ${adminUsername}, ${adminPasswordHash}, 'admin', 'System Admin', NULL)
    `;
  }

  const internCountRows = await sql`SELECT COUNT(*)::int AS count FROM interns`;
  if (!internCountRows[0].count) {
    for (const intern of seedInterns) {
      await sql`INSERT INTO interns (id, name, team) VALUES (${intern.id}, ${intern.name}, ${intern.team})`;
    }
  }

  return {
    async close() {
      await sql.end({ timeout: 5 });
    },
    async findUserByUsername(username) {
      const rows = await sql`
        SELECT id, username, password_hash AS "passwordHash", role, display_name AS "displayName", intern_id AS "internId"
        FROM users WHERE username = ${username}
      `;
      return rows[0] || null;
    },
    async findUserById(id) {
      const rows = await sql`
        SELECT id, username, role, display_name AS "displayName", intern_id AS "internId"
        FROM users WHERE id = ${id}
      `;
      return rows[0] || null;
    },
    async findUserWithPasswordById(id) {
      const rows = await sql`
        SELECT id, username, password_hash AS "passwordHash", role, display_name AS "displayName", intern_id AS "internId"
        FROM users WHERE id = ${id}
      `;
      return rows[0] || null;
    },
    async updateUserPassword(passwordHash, id) {
      await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`;
    },
    async createSession(token, userId) {
      await sql`INSERT INTO auth_sessions (token, user_id) VALUES (${token}, ${userId})`;
    },
    async getSessionUser(token) {
      const rows = await sql`
        SELECT users.id, users.username, users.role, users.display_name AS "displayName", users.intern_id AS "internId"
        FROM auth_sessions
        JOIN users ON users.id = auth_sessions.user_id
        WHERE auth_sessions.token = ${token}
      `;
      return rows[0] || null;
    },
    async deleteSession(token) {
      await sql`DELETE FROM auth_sessions WHERE token = ${token}`;
    },
    async savePasswordCode(userId, code, expiresAt) {
      await sql`
        INSERT INTO password_codes (user_id, code, expires_at)
        VALUES (${userId}, ${code}, ${expiresAt})
        ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at
      `;
    },
    async getPasswordCode(userId) {
      const rows = await sql`
        SELECT user_id AS "userId", code, expires_at AS "expiresAt"
        FROM password_codes WHERE user_id = ${userId}
      `;
      return rows[0] || null;
    },
    async deletePasswordCode(userId) {
      await sql`DELETE FROM password_codes WHERE user_id = ${userId}`;
    },
    async listInterns(date, attendanceSession) {
      const rows = await sql`
        SELECT
          interns.id,
          interns.name,
          interns.team,
          attendance_records.attendance_date AS "attendanceDate",
          attendance_records.attendance_session AS "attendanceSession",
          attendance_records.status_override AS "statusOverride"
        FROM interns
        LEFT JOIN attendance_records
          ON interns.id = attendance_records.intern_id
          AND attendance_records.attendance_date = ${date}
          AND attendance_records.attendance_session = ${attendanceSession}
        ORDER BY interns.created_at DESC, interns.name ASC
      `;
      return rows.map(mapInternRow);
    },
    async activeInternCount() {
      const rows = await sql`SELECT COUNT(*)::int AS count FROM interns`;
      return rows[0].count || 0;
    },
    async insertIntern(intern) {
      await sql`INSERT INTO interns (id, name, team) VALUES (${intern.id}, ${intern.name}, ${intern.team})`;
    },
    async findIntern(id) {
      const rows = await sql`SELECT id, name, team FROM interns WHERE id = ${id}`;
      return rows[0] || null;
    },
    async findInternWithCreatedAt(id) {
      const rows = await sql`
        SELECT id, name, team, created_at AS "createdAt"
        FROM interns WHERE id = ${id}
      `;
      return rows[0] || null;
    },
    async deleteIntern(id) {
      await sql`DELETE FROM interns WHERE id = ${id}`;
    },
    async listAttendanceForIntern(id) {
      return await sql`
        SELECT
          intern_id AS "internId",
          attendance_date AS "attendanceDate",
          attendance_session AS "attendanceSession",
          status_override AS "statusOverride",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM attendance_records
        WHERE intern_id = ${id}
      `;
    },
    async restoreIntern(intern, attendanceRecords) {
      await sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO interns (id, name, team, created_at)
          VALUES (${intern.id}, ${intern.name}, ${intern.team}, ${intern.createdAt})
        `;
        for (const record of attendanceRecords) {
          await transaction`
            INSERT INTO attendance_records (intern_id, attendance_date, attendance_session, status_override, created_at, updated_at)
            VALUES (
              ${record.internId},
              ${record.attendanceDate},
              ${record.attendanceSession},
              ${record.statusOverride},
              ${record.createdAt},
              ${record.updatedAt}
            )
          `;
        }
      });
    },
    async findAttendanceRecord(internId, attendanceDate, attendanceSession) {
      const rows = await sql`
        SELECT id
        FROM attendance_records
        WHERE intern_id = ${internId}
          AND attendance_date = ${attendanceDate}
          AND attendance_session = ${attendanceSession}
      `;
      return rows[0] || null;
    },
    async insertAttendance(record) {
      await sql`
        INSERT INTO attendance_records (intern_id, attendance_date, attendance_session, status_override)
        VALUES (${record.internId}, ${record.attendanceDate}, ${record.attendanceSession}, ${record.statusOverride})
      `;
    },
    async updateAttendance(record) {
      await sql`
        UPDATE attendance_records
        SET status_override = ${record.statusOverride}, updated_at = NOW()
        WHERE intern_id = ${record.internId}
          AND attendance_date = ${record.attendanceDate}
          AND attendance_session = ${record.attendanceSession}
      `;
    },
    async resetAttendance(attendanceDate, attendanceSession) {
      await sql`
        DELETE FROM attendance_records
        WHERE attendance_date = ${attendanceDate}
          AND attendance_session = ${attendanceSession}
      `;
    },
    async listDailyAttendance(date) {
      return await sql`
        SELECT
          interns.id,
          interns.name,
          interns.team,
          morning.status_override AS "morningStatus",
          evening.status_override AS "eveningStatus"
        FROM interns
        LEFT JOIN attendance_records AS morning
          ON interns.id = morning.intern_id
          AND morning.attendance_date = ${date}
          AND morning.attendance_session = 'morning'
        LEFT JOIN attendance_records AS evening
          ON interns.id = evening.intern_id
          AND evening.attendance_date = ${date}
          AND evening.attendance_session = 'evening'
        ORDER BY interns.created_at DESC, interns.name ASC
      `;
    },
    async listCombinedReport(start, end) {
      const rows = await sql`
        SELECT
          attendance_records.attendance_date AS "attendanceDate",
          attendance_records.intern_id AS "internId",
          interns.name,
          interns.team,
          MAX(CASE WHEN attendance_records.attendance_session = 'morning' THEN attendance_records.status_override END) AS "morningStatus",
          MAX(CASE WHEN attendance_records.attendance_session = 'evening' THEN attendance_records.status_override END) AS "eveningStatus"
        FROM attendance_records
        JOIN interns ON interns.id = attendance_records.intern_id
        WHERE attendance_records.attendance_date BETWEEN ${start} AND ${end}
        GROUP BY attendance_records.attendance_date, attendance_records.intern_id, interns.name, interns.team
        ORDER BY attendance_records.attendance_date DESC, interns.name ASC
      `;

      const summary = { totalRecords: 0, present: 0, late: 0, leave: 0, halfDay: 0, absent: 0 };
      const perDate = new Map();
      const detailedRecords = [];

      for (const row of rows) {
        const finalStatus = buildCombinedDailyStatus(row.morningStatus, row.eveningStatus);
        if (!finalStatus) continue;

        summary.totalRecords += 1;
        if (finalStatus === "Present") summary.present += 1;
        else if (finalStatus === "Late") summary.late += 1;
        else if (finalStatus === "Leave") summary.leave += 1;
        else if (finalStatus === "Half Day") summary.halfDay += 1;
        else summary.absent += 1;

        if (!perDate.has(row.attendanceDate)) {
          perDate.set(row.attendanceDate, {
            attendanceDate: row.attendanceDate,
            totalRecords: 0,
            present: 0,
            late: 0,
            leave: 0,
            halfDay: 0,
            absent: 0
          });
        }

        const bucket = perDate.get(row.attendanceDate);
        bucket.totalRecords += 1;
        if (finalStatus === "Present") bucket.present += 1;
        else if (finalStatus === "Late") bucket.late += 1;
        else if (finalStatus === "Leave") bucket.leave += 1;
        else if (finalStatus === "Half Day") bucket.halfDay += 1;
        else bucket.absent += 1;

        detailedRecords.push({
          internId: row.internId,
          internName: row.name,
          team: row.team,
          attendanceDate: row.attendanceDate,
          morningStatus: getStatus(row.morningStatus || ""),
          eveningStatus: getStatus(row.eveningStatus || ""),
          finalStatus
        });
      }

      return { summary, records: Array.from(perDate.values()), detailedRecords };
    }
  };
};

const createSqliteStorage = async ({ dbPath, dataDir, adminUsername, adminPasswordHash }) => {
  const Database = require("better-sqlite3");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS interns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intern_id TEXT NOT NULL,
      attendance_date TEXT NOT NULL,
      attendance_session TEXT NOT NULL DEFAULT 'morning',
      status_override TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(intern_id, attendance_date, attendance_session),
      FOREIGN KEY (intern_id) REFERENCES interns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      intern_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (intern_id) REFERENCES interns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_codes (
      user_id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
  `);

  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === "display_name")) {
    db.exec("ALTER TABLE users ADD COLUMN display_name TEXT");
    db.exec("UPDATE users SET display_name = username WHERE display_name IS NULL");
  }

  const countInterns = db.prepare("SELECT COUNT(*) AS count FROM interns").get();
  if (!countInterns.count) {
    const stmt = db.prepare("INSERT INTO interns (id, name, team) VALUES (@id, @name, @team)");
    seedInterns.forEach((intern) => stmt.run(intern));
  }

  const existingAdmin = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername);
  if (!existingAdmin) {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, display_name, intern_id)
      VALUES (@id, @username, @passwordHash, @role, @displayName, @internId)
    `).run({
      id: crypto.randomUUID(),
      username: adminUsername,
      passwordHash: adminPasswordHash,
      role: "admin",
      displayName: "System Admin",
      internId: null
    });
  }

  return {
    async close() {
      db.close();
    },
    async findUserByUsername(username) {
      return db.prepare(`
        SELECT id, username, password_hash AS passwordHash, role, display_name AS displayName, intern_id AS internId
        FROM users WHERE username = ?
      `).get(username) || null;
    },
    async findUserById(id) {
      return db.prepare(`
        SELECT id, username, role, display_name AS displayName, intern_id AS internId
        FROM users WHERE id = ?
      `).get(id) || null;
    },
    async findUserWithPasswordById(id) {
      return db.prepare(`
        SELECT id, username, password_hash AS passwordHash, role, display_name AS displayName, intern_id AS internId
        FROM users WHERE id = ?
      `).get(id) || null;
    },
    async updateUserPassword(passwordHash, id) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
    },
    async createSession(token, userId) {
      db.prepare("INSERT INTO auth_sessions (token, user_id) VALUES (?, ?)").run(token, userId);
    },
    async getSessionUser(token) {
      return db.prepare(`
        SELECT users.id, users.username, users.role, users.display_name AS displayName, users.intern_id AS internId
        FROM auth_sessions
        JOIN users ON users.id = auth_sessions.user_id
        WHERE auth_sessions.token = ?
      `).get(token) || null;
    },
    async deleteSession(token) {
      db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
    },
    async savePasswordCode(userId, code, expiresAt) {
      db.prepare(`
        INSERT INTO password_codes (user_id, code, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
      `).run(userId, code, expiresAt);
    },
    async getPasswordCode(userId) {
      return db.prepare(`
        SELECT user_id AS userId, code, expires_at AS expiresAt
        FROM password_codes WHERE user_id = ?
      `).get(userId) || null;
    },
    async deletePasswordCode(userId) {
      db.prepare("DELETE FROM password_codes WHERE user_id = ?").run(userId);
    },
    async listInterns(date, attendanceSession) {
      return db.prepare(`
        SELECT
          interns.id,
          interns.name,
          interns.team,
          attendance_records.attendance_date AS attendanceDate,
          attendance_records.attendance_session AS attendanceSession,
          attendance_records.status_override AS statusOverride
        FROM interns
        LEFT JOIN attendance_records
          ON interns.id = attendance_records.intern_id
          AND attendance_records.attendance_date = ?
          AND attendance_records.attendance_session = ?
        ORDER BY interns.created_at DESC, interns.name ASC
      `).all(date, attendanceSession).map(mapInternRow);
    },
    async activeInternCount() {
      return db.prepare("SELECT COUNT(*) AS count FROM interns").get().count;
    },
    async insertIntern(intern) {
      db.prepare("INSERT INTO interns (id, name, team) VALUES (@id, @name, @team)").run(intern);
    },
    async findIntern(id) {
      return db.prepare("SELECT id, name, team FROM interns WHERE id = ?").get(id) || null;
    },
    async findInternWithCreatedAt(id) {
      return db.prepare("SELECT id, name, team, created_at AS createdAt FROM interns WHERE id = ?").get(id) || null;
    },
    async deleteIntern(id) {
      db.prepare("DELETE FROM interns WHERE id = ?").run(id);
    },
    async listAttendanceForIntern(id) {
      return db.prepare(`
        SELECT
          intern_id AS internId,
          attendance_date AS attendanceDate,
          attendance_session AS attendanceSession,
          status_override AS statusOverride,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM attendance_records WHERE intern_id = ?
      `).all(id);
    },
    async restoreIntern(intern, attendanceRecords) {
      const transaction = db.transaction(() => {
        db.prepare(`
          INSERT INTO interns (id, name, team, created_at)
          VALUES (@id, @name, @team, @createdAt)
        `).run(intern);
        const stmt = db.prepare(`
          INSERT INTO attendance_records (intern_id, attendance_date, attendance_session, status_override, created_at, updated_at)
          VALUES (@internId, @attendanceDate, @attendanceSession, @statusOverride, @createdAt, @updatedAt)
        `);
        attendanceRecords.forEach((record) => stmt.run(record));
      });
      transaction();
    },
    async findAttendanceRecord(internId, attendanceDate, attendanceSession) {
      return db.prepare(`
        SELECT id FROM attendance_records
        WHERE intern_id = ? AND attendance_date = ? AND attendance_session = ?
      `).get(internId, attendanceDate, attendanceSession) || null;
    },
    async insertAttendance(record) {
      db.prepare(`
        INSERT INTO attendance_records (intern_id, attendance_date, attendance_session, status_override)
        VALUES (@internId, @attendanceDate, @attendanceSession, @statusOverride)
      `).run(record);
    },
    async updateAttendance(record) {
      db.prepare(`
        UPDATE attendance_records
        SET status_override = @statusOverride, updated_at = CURRENT_TIMESTAMP
        WHERE intern_id = @internId
          AND attendance_date = @attendanceDate
          AND attendance_session = @attendanceSession
      `).run(record);
    },
    async resetAttendance(attendanceDate, attendanceSession) {
      db.prepare("DELETE FROM attendance_records WHERE attendance_date = ? AND attendance_session = ?").run(attendanceDate, attendanceSession);
    },
    async listDailyAttendance(date) {
      return db.prepare(`
        SELECT
          interns.id,
          interns.name,
          interns.team,
          morning.status_override AS morningStatus,
          evening.status_override AS eveningStatus
        FROM interns
        LEFT JOIN attendance_records AS morning
          ON interns.id = morning.intern_id
          AND morning.attendance_date = ?
          AND morning.attendance_session = 'morning'
        LEFT JOIN attendance_records AS evening
          ON interns.id = evening.intern_id
          AND evening.attendance_date = ?
          AND evening.attendance_session = 'evening'
        ORDER BY interns.created_at DESC, interns.name ASC
      `).all(date, date);
    },
    async listCombinedReport(start, end) {
      const rows = db.prepare(`
        SELECT
          attendance_records.attendance_date AS attendanceDate,
          attendance_records.intern_id AS internId,
          interns.name,
          interns.team,
          MAX(CASE WHEN attendance_records.attendance_session = 'morning' THEN attendance_records.status_override END) AS morningStatus,
          MAX(CASE WHEN attendance_records.attendance_session = 'evening' THEN attendance_records.status_override END) AS eveningStatus
        FROM attendance_records
        JOIN interns ON interns.id = attendance_records.intern_id
        WHERE attendance_records.attendance_date BETWEEN ? AND ?
        GROUP BY attendance_records.attendance_date, attendance_records.intern_id, interns.name, interns.team
        ORDER BY attendance_records.attendance_date DESC, interns.name ASC
      `).all(start, end);

      const summary = { totalRecords: 0, present: 0, late: 0, leave: 0, halfDay: 0, absent: 0 };
      const perDate = new Map();
      const detailedRecords = [];

      rows.forEach((row) => {
        const finalStatus = buildCombinedDailyStatus(row.morningStatus, row.eveningStatus);
        if (!finalStatus) return;

        summary.totalRecords += 1;
        if (finalStatus === "Present") summary.present += 1;
        else if (finalStatus === "Late") summary.late += 1;
        else if (finalStatus === "Leave") summary.leave += 1;
        else if (finalStatus === "Half Day") summary.halfDay += 1;
        else summary.absent += 1;

        if (!perDate.has(row.attendanceDate)) {
          perDate.set(row.attendanceDate, {
            attendanceDate: row.attendanceDate,
            totalRecords: 0,
            present: 0,
            late: 0,
            leave: 0,
            halfDay: 0,
            absent: 0
          });
        }

        const bucket = perDate.get(row.attendanceDate);
        bucket.totalRecords += 1;
        if (finalStatus === "Present") bucket.present += 1;
        else if (finalStatus === "Late") bucket.late += 1;
        else if (finalStatus === "Leave") bucket.leave += 1;
        else if (finalStatus === "Half Day") bucket.halfDay += 1;
        else bucket.absent += 1;

        detailedRecords.push({
          internId: row.internId,
          internName: row.name,
          team: row.team,
          attendanceDate: row.attendanceDate,
          morningStatus: getStatus(row.morningStatus || ""),
          eveningStatus: getStatus(row.eveningStatus || ""),
          finalStatus
        });
      });

      return { summary, records: Array.from(perDate.values()), detailedRecords };
    }
  };
};

const createStorage = async (options) => {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";
  if (connectionString) {
    return createPostgresStorage({
      connectionString,
      adminUsername: options.adminUsername,
      adminPasswordHash: options.adminPasswordHash
    });
  }

  return createSqliteStorage(options);
};

module.exports = {
  createStorage
};

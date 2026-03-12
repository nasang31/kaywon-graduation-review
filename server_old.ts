import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import pg from "pg";
import path from "path";
import fs from "fs";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { GoogleSheetsDB } from "./googleSheetsDb.js";

const { Pool } = pg;

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        role: string;
      };
    }
  }
}

const app = express();
const PORT = 3000;

// Database configuration
const usePostgres = !!process.env.DB_HOST;
const useSheets = !!process.env.GOOGLE_SHEET_ID;
let sqliteDb: any = null;
let pgPool: any = null;
let sheetsDb: any = null;

if (useSheets) {
  console.log("Using Google Sheets as Database");
  sheetsDb = new GoogleSheetsDB(
    process.env.GOOGLE_SHEET_ID!,
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    process.env.GOOGLE_PRIVATE_KEY!
  );
} else if (usePostgres) {
  console.log("Using PostgreSQL (Cloud SQL)");
  pgPool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || "5432"),
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  console.log("Using local SQLite");
  sqliteDb = new Database("database.sqlite");
  sqliteDb.pragma('foreign_keys = ON');
}

// Unified database interface
const db = {
  async exec(sql: string) {
    if (useSheets) {
      await sheetsDb.init();
      return;
    }
    if (usePostgres) {
      const pgSql = sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "SERIAL PRIMARY KEY")
        .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        .replace(/TEXT UNIQUE/g, "TEXT UNIQUE")
        .replace(/INTEGER PRIMARY KEY/g, "INTEGER PRIMARY KEY");
      await pgPool.query(pgSql);
    } else {
      sqliteDb.exec(sql);
    }
  },
  async query(sql: string, params: any[] = []) {
    if (useSheets) {
      return this.handleSheetsQuery(sql, params);
    }
    if (usePostgres) {
      let i = 1;
      const pgSql = sql.replace(/\?/g, () => `$${i++}`);
      const res = await pgPool.query(pgSql, params);
      return res.rows;
    } else {
      return sqliteDb.prepare(sql).all(...params);
    }
  },
  async get(sql: string, params: any[] = []) {
    if (useSheets) {
      const rows = await this.handleSheetsQuery(sql, params);
      return rows[0] || null;
    }
    if (usePostgres) {
      let i = 1;
      const pgSql = sql.replace(/\?/g, () => `$${i++}`);
      const res = await pgPool.query(pgSql, params);
      return res.rows[0] || null;
    } else {
      return sqliteDb.prepare(sql).get(...params);
    }
  },
  async run(sql: string, params: any[] = []) {
    if (useSheets) {
      return this.handleSheetsRun(sql, params);
    }
    if (usePostgres) {
      let i = 1;
      const pgSql = sql.replace(/\?/g, () => `$${i++}`);
      const res = await pgPool.query(pgSql, params);
      return { lastInsertRowid: null, changes: res.rowCount };
    } else {
      const res = sqliteDb.prepare(sql).run(...params);
      return { lastInsertRowid: res.lastInsertRowid, changes: res.changes };
    }
  },

  // Basic SQL to Sheets mapper for the specific queries used in this app
  async handleSheetsQuery(sql: string, params: any[]): Promise<any[]> {
    const s = sql.toLowerCase();
    if (s.includes("from users")) {
      if (s.includes("where username = ?")) return sheetsDb.query("users", (r: any) => r.username === params[0]);
      if (s.includes("where role = 'student'")) return sheetsDb.query("users", (r: any) => r.role === 'student');
      return sheetsDb.query("users");
    }
    if (s.includes("from rounds")) return sheetsDb.query("rounds");
    if (s.includes("from proposals")) {
      if (s.includes("where user_id = ? and round_number = ?")) return sheetsDb.query("proposals", (r: any) => Number(r.user_id) === Number(params[0]) && Number(r.round_number) === Number(params[1]));
      if (s.includes("where id = ?")) return sheetsDb.query("proposals", (r: any) => Number(r.id) === Number(params[0]));
      if (s.includes("where round_number = ? and is_participating = 1")) return sheetsDb.query("proposals", (r: any) => Number(r.round_number) === Number(params[0]) && Number(r.is_participating) === 1);
      return sheetsDb.query("proposals");
    }
    if (s.includes("from works")) {
      if (s.includes("where proposal_id = ?")) return sheetsDb.query("works", (r: any) => Number(r.proposal_id) === Number(params[0]));
      return sheetsDb.query("works");
    }
    if (s.includes("from work_images")) {
      if (s.includes("where work_id = ?")) return sheetsDb.query("work_images", (r: any) => Number(r.work_id) === Number(params[0]));
      return sheetsDb.query("work_images");
    }
    if (s.includes("from evaluations")) {
      if (s.includes("where proposal_id = ?")) return sheetsDb.query("evaluations", (r: any) => Number(r.proposal_id) === Number(params[0]));
      return sheetsDb.query("evaluations");
    }
    if (s.includes("select count(*)")) {
      const table = s.split("from ")[1].split(" ")[0].trim();
      const rows = await sheetsDb.query(table);
      return [{ count: rows.length }];
    }
    return [];
  },

  async handleSheetsRun(sql: string, params: any[]): Promise<any> {
    const s = sql.toLowerCase();
    if (s.includes("insert into users")) {
      const res = await sheetsDb.insert("users", {
        username: params[0], password: params[1], role: params[2], name: params[3], student_id: params[4], needs_password_change: params[5], initial_password: params[6]
      });
      return { lastInsertRowid: res.id, changes: 1 };
    }
    if (s.includes("insert into rounds")) {
      const res = await sheetsDb.insert("rounds", {
        round_number: params[0], is_open: params[1], name: params[2]
      });
      return { lastInsertRowid: res.round_number, changes: 1 };
    }
    if (s.includes("update users set password = ?")) {
      return sheetsDb.update("users", (r: any) => Number(r.id) === Number(params[1]), { password: params[0], needs_password_change: 0 });
    }
    if (s.includes("update rounds set is_open = ?")) {
      return sheetsDb.update("rounds", (r: any) => Number(r.round_number) === Number(params[1]), { is_open: params[0] });
    }
    if (s.includes("insert into proposals")) {
      const res = await sheetsDb.insert("proposals", {
        user_id: params[0], round_number: params[1], student_id: params[2], name: params[3], career_path: params[4], title: params[5], author: params[6], genre: params[7], plot: params[8], subject: params[9], reason: params[10], is_submitted: params[11], presentation_order: params[12], is_participating: params[13]
      });
      return { lastInsertRowid: res.id, changes: 1 };
    }
    if (s.includes("insert into works")) {
      const res = await sheetsDb.insert("works", {
        proposal_id: params[0], work_number: params[1], title: params[2], category: params[3], summary: params[4], keywords: params[5], purpose: params[6], effect: params[7]
      });
      return { lastInsertRowid: res.id, changes: 1 };
    }
    if (s.includes("insert into work_images")) {
      const res = await sheetsDb.insert("work_images", { work_id: params[0], url: params[1] });
      return { lastInsertRowid: res.id, changes: 1 };
    }
    if (s.includes("insert into evaluations")) {
      // Handle ON CONFLICT by checking if exists
      const existing = await sheetsDb.get("evaluations", (r: any) => Number(r.proposal_id) === Number(params[0]) && Number(r.judge_id) === Number(params[1]));
      if (existing) {
        return sheetsDb.update("evaluations", (r: any) => Number(r.proposal_id) === Number(params[0]) && Number(r.judge_id) === Number(params[1]), {
          text_grade: params[2], work1_grade: params[3], work2_grade: params[4], work3_grade: params[5], comment: params[6]
        });
      } else {
        const res = await sheetsDb.insert("evaluations", {
          proposal_id: params[0], judge_id: params[1], text_grade: params[2], work1_grade: params[3], work2_grade: params[4], work3_grade: params[5], comment: params[6]
        });
        return { lastInsertRowid: res.id, changes: 1 };
      }
    }
    if (s.includes("delete from evaluations")) {
      return sheetsDb.delete("evaluations", (r: any) => Number(r.proposal_id) === Number(params[0]) && Number(r.judge_id) === Number(params[1]));
    }
    if (s.includes("update proposals set is_participating = ?, presentation_order = ?")) {
      return sheetsDb.update("proposals", (r: any) => Number(r.user_id) === Number(params[2]) && Number(r.round_number) === Number(params[3]), { is_participating: params[0], presentation_order: params[1] });
    }
    if (s.includes("update proposals set presentation_order = ?")) {
      return sheetsDb.update("proposals", (r: any) => Number(r.id) === Number(params[2]), { presentation_order: params[0], is_participating: params[1] });
    }
    if (s.includes("delete from work_images")) {
      return sheetsDb.delete("work_images", (r: any) => Number(r.work_id) === Number(params[0]));
    }
    if (s.includes("delete from works")) {
      return sheetsDb.delete("works", (r: any) => Number(r.proposal_id) === Number(params[0]));
    }
    if (s.includes("delete from proposals")) {
      return sheetsDb.delete("proposals", (r: any) => Number(r.id) === Number(params[0]));
    }
    if (s.includes("delete from users")) {
      return sheetsDb.delete("users", (r: any) => Number(r.id) === Number(params[0]));
    }
    if (s.includes("truncate") || s.includes("delete from")) {
      const table = s.split("from ")[1].split(" ")[0].trim();
      return sheetsDb.clear(table);
    }
    return { lastInsertRowid: null, changes: 0 };
  }
};

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-this-in-production";

// Middleware to verify JWT
const authenticate = (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie("token");
    return res.status(401).json({ error: "인증 세션이 만료되었습니다. 다시 로그인해주세요." });
  }
};

// Middleware to check roles
const authorize = (roles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    next();
  };
};

async function startServer() {
  // Initialize Database
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT,
      name TEXT,
      student_id TEXT,
      needs_password_change INTEGER DEFAULT 1,
      initial_password TEXT
    );

    CREATE TABLE IF NOT EXISTS rounds (
      round_number INTEGER PRIMARY KEY,
      is_open INTEGER DEFAULT 0,
      name TEXT
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      round_number INTEGER DEFAULT 1,
      student_id TEXT,
      name TEXT,
      career_path TEXT,
      title TEXT,
      author TEXT,
      genre TEXT,
      plot TEXT,
      subject TEXT,
      reason TEXT,
      is_submitted INTEGER DEFAULT 0,
      presentation_order INTEGER DEFAULT 0,
      is_participating INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, round_number)
    );

    CREATE TABLE IF NOT EXISTS works (
      id SERIAL PRIMARY KEY,
      proposal_id INTEGER,
      work_number INTEGER,
      title TEXT,
      category TEXT,
      summary TEXT,
      keywords TEXT,
      purpose TEXT,
      effect TEXT
    );

    CREATE TABLE IF NOT EXISTS work_images (
      id SERIAL PRIMARY KEY,
      work_id INTEGER,
      url TEXT
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id SERIAL PRIMARY KEY,
      proposal_id INTEGER,
      judge_id INTEGER,
      text_grade TEXT,
      work1_grade TEXT,
      work2_grade TEXT,
      work3_grade TEXT,
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proposal_id, judge_id)
    );
  `);

  // Migration: Ensure tables have required columns (PostgreSQL handles this differently, but we'll try to be safe)
  if (!usePostgres && !useSheets) {
    const proposalTableInfo = sqliteDb.prepare("PRAGMA table_info(proposals)").all() as any[];
    const proposalColumns = proposalTableInfo.map(c => c.name);
    if (!proposalColumns.includes('is_submitted')) {
      await db.exec("ALTER TABLE proposals ADD COLUMN is_submitted INTEGER DEFAULT 0");
    }
    if (!proposalColumns.includes('presentation_order')) {
      await db.exec("ALTER TABLE proposals ADD COLUMN presentation_order INTEGER DEFAULT 0");
    }
    if (!proposalColumns.includes('is_participating')) {
      await db.exec("ALTER TABLE proposals ADD COLUMN is_participating INTEGER DEFAULT 0");
    }

    const evalTableInfo = sqliteDb.prepare("PRAGMA table_info(evaluations)").all() as any[];
    const evalColumns = evalTableInfo.map(c => c.name);
    if (!evalColumns.includes('text_grade')) await db.exec("ALTER TABLE evaluations ADD COLUMN text_grade TEXT");
    if (!evalColumns.includes('work1_grade')) await db.exec("ALTER TABLE evaluations ADD COLUMN work1_grade TEXT");
    if (!evalColumns.includes('work2_grade')) await db.exec("ALTER TABLE evaluations ADD COLUMN work2_grade TEXT");
    if (!evalColumns.includes('work3_grade')) await db.exec("ALTER TABLE evaluations ADD COLUMN work3_grade TEXT");
  }

  // Migration: Update existing grades to new format (A -> A0, etc.)
  if (!useSheets) {
    await db.exec(`
      UPDATE evaluations SET text_grade = 'A0' WHERE text_grade = 'A';
      UPDATE evaluations SET text_grade = 'B0' WHERE text_grade = 'B';
      UPDATE evaluations SET text_grade = 'C0' WHERE text_grade = 'C';
      UPDATE evaluations SET text_grade = 'D0' WHERE text_grade = 'D';
      UPDATE evaluations SET work1_grade = 'A0' WHERE work1_grade = 'A';
      UPDATE evaluations SET work1_grade = 'B0' WHERE work1_grade = 'B';
      UPDATE evaluations SET work1_grade = 'C0' WHERE work1_grade = 'C';
      UPDATE evaluations SET work1_grade = 'D0' WHERE work1_grade = 'D';
      UPDATE evaluations SET work2_grade = 'A0' WHERE work2_grade = 'A';
      UPDATE evaluations SET work2_grade = 'B0' WHERE work2_grade = 'B';
      UPDATE evaluations SET work2_grade = 'C0' WHERE work2_grade = 'C';
      UPDATE evaluations SET work2_grade = 'D0' WHERE work2_grade = 'D';
      UPDATE evaluations SET work3_grade = 'A0' WHERE work3_grade = 'A';
      UPDATE evaluations SET work3_grade = 'B0' WHERE work3_grade = 'B';
      UPDATE evaluations SET work3_grade = 'C0' WHERE work3_grade = 'C';
      UPDATE evaluations SET work3_grade = 'D0' WHERE work3_grade = 'D';
    `);
  }

  // Helper to hash password
  const hashPassword = (pw: string) => bcrypt.hashSync(pw, 10);

  // Seed initial users and rounds if empty
  const userCount = await db.get("SELECT COUNT(*) as count FROM users") as { count: number | string };
  if (Number(userCount.count) === 0) {
    const insertSql = "INSERT INTO users (username, password, role, name, student_id, needs_password_change, initial_password) VALUES (?, ?, ?, ?, ?, ?, ?)";
    
    // Admin
    await db.run(insertSql, ["admin", hashPassword("admin123"), "admin", "학과장", null, 0, "admin123"]);
    
    // Judges
    await db.run(insertSql, ["judge1", hashPassword("judge1"), "judge", "김교수", null, 1, "judge1"]);
    await db.run(insertSql, ["judge2", hashPassword("judge2"), "judge", "이교수", null, 1, "judge2"]);
    await db.run(insertSql, ["judge3", hashPassword("judge3"), "judge", "박교수", null, 1, "judge3"]);
    await db.run(insertSql, ["judge4", hashPassword("judge4"), "judge", "최교수", null, 1, "judge4"]);
    await db.run(insertSql, ["judge5", hashPassword("judge5"), "judge", "정교수", null, 1, "judge5"]);
    
    // Students
    await db.run(insertSql, ["20240001", hashPassword("20240001"), "student", "홍길동", "20240001", 1, "20240001"]);
  }

  const roundCount = await db.get("SELECT COUNT(*) as count FROM rounds") as { count: number | string };
  if (Number(roundCount.count) === 0) {
    const insertSql = "INSERT INTO rounds (round_number, is_open, name) VALUES (?, ?, ?)";
    await db.run(insertSql, [1, 1, "졸업작품 기획 1차 심사"]);
    await db.run(insertSql, [2, 0, "졸업작품 기획 2차 심사"]);
    await db.run(insertSql, [3, 0, "졸업작품 기획 3차 심사"]);
  }

  app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// File Upload Setup
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    cb(null, `${Date.now()}-${name}${ext}`);
  },
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = /image\/(jpeg|jpg|png|gif|webp|heic|heif)/;
    const allowedExtensions = /.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
    
    const mimetype = allowedMimeTypes.test(file.mimetype);
    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    
    // If it's a valid image mimetype, we allow it even if the extension is missing (e.g. blob uploads)
    if (mimetype) {
      return cb(null, true);
    }
    
    // If mimetype is generic but extension is valid
    if (extname) {
      return cb(null, true);
    }

    cb(new Error(`허용되지 않는 파일 형식입니다. (MIME: ${file.mimetype}, Ext: ${path.extname(file.originalname)})`));
  }
});

// Auth API
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE username = ?", [username]) as any;
  
  if (user && bcrypt.compareSync(password, user.password)) {
    const { password: _, ...userWithoutPassword } = user;
    
    // Issue JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json(userWithoutPassword);
  } else {
    res.status(401).json({ error: "아이디 또는 비밀번호가 일치하지 않습니다." });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

app.post("/api/change-password", authenticate, async (req, res) => {
  const { userId, newPassword } = req.body;
  
  // Ensure user can only change their own password unless admin
  if (req.user.role !== 'admin' && req.user.id !== Number(userId)) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  try {
    await db.run("UPDATE users SET password = ?, needs_password_change = 0 WHERE id = ?", [hashPassword(newPassword), userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "비밀번호 변경에 실패했습니다." });
  }
});

// Admin - User Management
app.get("/api/admin/users", authenticate, authorize(['admin']), async (req, res) => {
  const users = await db.query("SELECT id, username, name, role, student_id, needs_password_change FROM users WHERE role != 'admin'");
  res.json(users);
});

app.get("/api/admin/rounds", authenticate, async (req, res) => {
  const rounds = await db.query("SELECT * FROM rounds");
  res.json(rounds);
});

app.post("/api/admin/rounds/toggle", authenticate, authorize(['admin']), async (req, res) => {
  const { roundNumber, isOpen } = req.body;
  await db.run("UPDATE rounds SET is_open = ? WHERE round_number = ?", [isOpen ? 1 : 0, roundNumber]);
  res.json({ success: true });
});

app.post("/api/admin/clear-data", authenticate, authorize(['admin']), async (req, res) => {
  try {
    await db.run("DELETE FROM work_images");
    await db.run("DELETE FROM works");
    await db.run("DELETE FROM evaluations");
    await db.run("DELETE FROM proposals");
    await db.run("DELETE FROM users WHERE role != 'admin'");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "데이터 초기화 실패" });
  }
});

app.post("/api/admin/seed", authenticate, authorize(['admin']), async (req, res) => {
  try {
    // 1. Clear existing non-admin data
    await db.run("DELETE FROM work_images");
    await db.run("DELETE FROM works");
    await db.run("DELETE FROM evaluations");
    await db.run("DELETE FROM proposals");
    await db.run("DELETE FROM users WHERE role != 'admin'");

    // 2. Create 5 Judges
    const insertSql = "INSERT INTO users (username, password, role, name, student_id, needs_password_change, initial_password) VALUES (?, ?, ?, ?, ?, ?, ?)";
    const judges = [];
    for (let i = 1; i <= 5; i++) {
      const username = `judge${i}`;
      const name = `${['김', '이', '박', '최', '정'][i-1]}교수`;
      await db.run(insertSql, [username, hashPassword(username), "judge", name, null, 1, username]);
      const user = await db.get("SELECT id FROM users WHERE username = ?", [username]);
      judges.push({ id: user.id, name });
    }

    // 3. Create 30 Students and Proposals
    const grades = ["A+", "A0", "A-", "B+", "B0", "B-", "C+"];
    
    for (let i = 1; i <= 30; i++) {
      const studentId = `2024${String(i).padStart(4, '0')}`;
      const name = `학생${i}`;
      await db.run(insertSql, [studentId, hashPassword(studentId), "student", name, studentId, 1, studentId]);
      const user = await db.get("SELECT id FROM users WHERE username = ?", [studentId]);
      const userId = user.id;
      
      // Create proposals for all 3 rounds
      for (let roundNum = 1; roundNum <= 3; roundNum++) {
        await db.run(`
          INSERT INTO proposals (user_id, round_number, student_id, name, career_path, title, author, genre, plot, subject, reason, is_submitted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [userId, roundNum, studentId, name, "공간 연출가", `${roundNum}차 졸업작품 기획안 ${i}`, "본인", "드라마", "줄거리...", "주제...", "기획의도...", 1]);
        
        const proposal = await db.get("SELECT id FROM proposals WHERE user_id = ? AND round_number = ?", [userId, roundNum]);
        const proposalId = proposal.id;
        
        // Create 3 works for each proposal
        for (let j = 1; j <= 3; j++) {
          await db.run(`
            INSERT INTO works (proposal_id, work_number, title, category, summary, keywords, purpose, effect)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [proposalId, j, `작품 ${j}`, "공간설계", "요약...", "키워드", "목적", "효과"]);
          
          const work = await db.get("SELECT id FROM works WHERE proposal_id = ? AND work_number = ?", [proposalId, j]);
          const workId = work.id;
          // Add a dummy image
          await db.run("INSERT INTO work_images (work_id, url) VALUES (?, ?)", [workId, `https://picsum.photos/seed/student${i}round${roundNum}work${j}/800/600`]);
        }

        // 4. Create Evaluations from all 5 judges for this student in this round
        for (const judge of judges) {
          const textGrade = grades[Math.floor(Math.random() * grades.length)];
          const w1Grade = grades[Math.floor(Math.random() * grades.length)];
          const w2Grade = grades[Math.floor(Math.random() * grades.length)];
          const w3Grade = grades[Math.floor(Math.random() * grades.length)];
          
          await db.run(`
            INSERT INTO evaluations (proposal_id, judge_id, text_grade, work1_grade, work2_grade, work3_grade, comment)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [proposalId, judge.id, textGrade, w1Grade, w2Grade, w3Grade, `${roundNum}차 심사평: 학생${i}의 작품은 매우 인상적입니다. (by ${judge.name})`]);
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/admin/users", authenticate, authorize(['admin']), async (req, res) => {
  const { username, name, role, student_id } = req.body;
  try {
    await db.run("INSERT INTO users (username, password, role, name, student_id, needs_password_change, initial_password) VALUES (?, ?, ?, ?, ?, 1, ?)",
      [username, hashPassword(username), role, name, student_id || null, username]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "이미 존재하는 아이디입니다." });
  }
});

app.post("/api/admin/users/reset-password", authenticate, authorize(['admin']), async (req, res) => {
  const { userId } = req.body;
  const user = await db.get("SELECT username FROM users WHERE id = ?", [userId]) as any;
  if (user) {
    await db.run("UPDATE users SET password = ?, needs_password_change = 1 WHERE id = ?", [hashPassword(user.username), userId]);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  }
});

app.delete("/api/admin/users/:id", authenticate, authorize(['admin']), async (req, res) => {
  const userId = Number(req.params.id);
  
  try {
    const user = await db.get("SELECT username, role FROM users WHERE id = ?", [userId]) as any;
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }
    if (user.username === 'admin') {
      return res.status(403).json({ error: "관리자 계정은 삭제할 수 없습니다." });
    }

    // 1. Delete all images related to works of proposals of this user
    await db.run(`
      DELETE FROM work_images 
      WHERE work_id IN (
        SELECT id FROM works 
        WHERE proposal_id IN (
          SELECT id FROM proposals WHERE user_id = ?
        )
      )
    `, [userId]);

    // 2. Delete all works related to proposals of this user
    await db.run(`
      DELETE FROM works 
      WHERE proposal_id IN (
        SELECT id FROM proposals WHERE user_id = ?
      )
    `, [userId]);

    // 3. Delete all evaluations related to proposals of this user
    await db.run(`
      DELETE FROM evaluations 
      WHERE proposal_id IN (
        SELECT id FROM proposals WHERE user_id = ?
      )
    `, [userId]);

    // 4. Delete all proposals of this user
    await db.run("DELETE FROM proposals WHERE user_id = ?", [userId]);

    // 5. Delete all evaluations made by this user
    await db.run("DELETE FROM evaluations WHERE judge_id = ?", [userId]);

    // 6. Finally delete the user
    const result = await db.run("DELETE FROM users WHERE id = ?", [userId]);
    
    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "삭제할 사용자를 찾지 못했습니다." });
    }
  } catch (err) {
    console.error("[ADMIN] Delete user error:", err);
    res.status(500).json({ error: "사용자 삭제 중 오류가 발생했습니다: " + (err as Error).message });
  }
});

// Student API
app.post("/api/proposals", authenticate, authorize(['student', 'admin']), async (req, res) => {
  const { userId, roundNumber, studentId, name, careerPath, title, author, genre, plot, subject, reason, works, is_submitted } = req.body;
  
  // Ensure student can only edit their own proposal
  if (req.user.role === 'student' && req.user.id !== Number(userId)) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }
  
  // Check if round is open
  const round = await db.get("SELECT is_open FROM rounds WHERE round_number = ?", [roundNumber]) as any;
  if (!round || !round.is_open) {
    return res.status(403).json({ error: "현재 심사 기간이 아닙니다." });
  }

  // Check if already evaluated
  const existingProposal = await db.get("SELECT id, is_submitted FROM proposals WHERE user_id = ? AND round_number = ?", [userId, roundNumber]) as any;
  if (existingProposal) {
    const evalCount = await db.get("SELECT COUNT(*) as count FROM evaluations WHERE proposal_id = ?", [existingProposal.id]) as any;
    if (Number(evalCount.count) > 0) {
      return res.status(403).json({ error: "심사가 완료된 기획안은 수정할 수 없습니다." });
    }
  }

  try {
    let presentationOrder = 0;
    let isParticipating = 0;

    // Preserve existing metadata if proposal exists
    if (existingProposal) {
      const metadata = await db.get("SELECT presentation_order, is_participating FROM proposals WHERE id = ?", [existingProposal.id]) as any;
      if (metadata) {
        presentationOrder = metadata.presentation_order;
        isParticipating = metadata.is_participating;
      }

      const workIds = await db.query("SELECT id FROM works WHERE proposal_id = ?", [existingProposal.id]) as any[];
      for (const w of workIds) {
        await db.run("DELETE FROM work_images WHERE work_id = ?", [w.id]);
      }
      await db.run("DELETE FROM works WHERE proposal_id = ?", [existingProposal.id]);
      await db.run("DELETE FROM proposals WHERE id = ?", [existingProposal.id]);
    }

    const isSubmittedValue = (is_submitted === true || is_submitted === 1) ? 1 : 0;

    await db.run(`
      INSERT INTO proposals (user_id, round_number, student_id, name, career_path, title, author, genre, plot, subject, reason, is_submitted, presentation_order, is_participating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, roundNumber, studentId, name, careerPath, title, author, genre, plot, subject, reason, isSubmittedValue, presentationOrder, isParticipating]);

    const proposal = await db.get("SELECT id FROM proposals WHERE user_id = ? AND round_number = ?", [userId, roundNumber]);
    const proposalId = proposal.id;

    for (const work of works) {
      await db.run(`
        INSERT INTO works (proposal_id, work_number, title, category, summary, keywords, purpose, effect)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [proposalId, work.workNumber, work.title, work.category, work.summary, work.keywords, work.purpose, work.effect]);
      
      const workData = await db.get("SELECT id FROM works WHERE proposal_id = ? AND work_number = ?", [proposalId, work.workNumber]);
      const workId = workData.id;
      
      if (work.images && Array.isArray(work.images)) {
        for (const imgUrl of work.images) {
          await db.run("INSERT INTO work_images (work_id, url) VALUES (?, ?)", [workId, imgUrl]);
        }
      }
    }
    
    res.json({ success: true, id: proposalId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/proposals/my/:userId/:roundNumber", authenticate, async (req, res) => {
  // Ensure student can only view their own proposal
  if (req.user.role === 'student' && req.user.id !== Number(req.params.userId)) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }
  const proposal = await db.get("SELECT * FROM proposals WHERE user_id = ? AND round_number = ?", [req.params.userId, req.params.roundNumber]) as any;
  if (proposal) {
    const works = await db.query("SELECT * FROM works WHERE proposal_id = ?", [proposal.id]) as any[];
    for (const work of works) {
      const images = await db.query("SELECT url FROM work_images WHERE work_id = ?", [work.id]) as any[];
      work.images = images.map(i => i.url);
    }
    const evals = await db.get("SELECT COUNT(*) as count FROM evaluations WHERE proposal_id = ?", [proposal.id]) as any;
    res.json({ ...proposal, works, is_evaluated: Number(evals.count) > 0 });
  } else {
    res.json(null);
  }
});

// Judge API
app.get("/api/students/:roundNumber", authenticate, authorize(['judge', 'admin']), async (req, res) => {
  const judgeId = req.query.judgeId;
  
  // Ensure judge can only see their own eval counts
  if (req.user.role === 'judge' && req.user.id !== Number(judgeId)) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }
  const students = await db.query(`
    SELECT p.*, u.name as student_name, 
    (SELECT COUNT(*) FROM evaluations e WHERE e.proposal_id = p.id) as total_eval_count,
    (SELECT COUNT(*) FROM evaluations e WHERE e.proposal_id = p.id AND e.judge_id = ?) as my_eval_count,
    e.text_grade as my_text_grade, e.work1_grade as my_work1_grade, e.work2_grade as my_work2_grade, e.work3_grade as my_work3_grade
    FROM proposals p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN evaluations e ON e.proposal_id = p.id AND e.judge_id = ?
    WHERE p.round_number = ? AND p.is_participating = 1
    ORDER BY p.presentation_order ASC, p.id ASC
  `, [judgeId, judgeId, req.params.roundNumber]);
  res.json(students);
});

app.get("/api/proposals/:id", authenticate, async (req, res) => {
  const judgeId = req.query.judgeId ? Number(req.query.judgeId) : null;
  const role = req.query.role as string;

  // Security check
  if (req.user.role === 'judge' && req.user.id !== judgeId) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  const proposal = await db.get("SELECT * FROM proposals WHERE id = ?", [req.params.id]) as any;
  if (proposal) {
    // If student, ensure they only see their own
    if (req.user.role === 'student' && req.user.id !== proposal.user_id) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    proposal.careerPath = proposal.career_path;
    proposal.studentId = proposal.student_id;

    const works = await db.query("SELECT * FROM works WHERE proposal_id = ?", [proposal.id]) as any[];
    for (const work of works) {
      const images = await db.query("SELECT url FROM work_images WHERE work_id = ?", [work.id]) as any[];
      work.images = images.map(i => i.url);
    }

    let evalsQuery = `
      SELECT e.*, u.name as judge_name 
      FROM evaluations e 
      JOIN users u ON e.judge_id = u.id 
      WHERE e.proposal_id = ?
    `;
    
    let evals;
    if (req.user.role === 'admin') {
      evals = await db.query(evalsQuery, [proposal.id]);
    } else if (req.user.role === 'judge') {
      evalsQuery += " AND e.judge_id = ?";
      evals = await db.query(evalsQuery, [proposal.id, req.user.id]);
    } else {
      evals = [];
    }

    res.json({ ...proposal, works, evaluations: evals });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

app.post("/api/evaluations", authenticate, authorize(['judge', 'admin']), async (req, res) => {
  const { proposalId, judgeId, text_grade, work1_grade, work2_grade, work3_grade, comment } = req.body;
  
  // Security check
  if (req.user.role === 'judge' && req.user.id !== Number(judgeId)) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }
  try {
    await db.run(`
      INSERT INTO evaluations (proposal_id, judge_id, text_grade, work1_grade, work2_grade, work3_grade, comment)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(proposal_id, judge_id) DO UPDATE SET
      text_grade = EXCLUDED.text_grade,
      work1_grade = EXCLUDED.work1_grade,
      work2_grade = EXCLUDED.work2_grade,
      work3_grade = EXCLUDED.work3_grade,
      comment = EXCLUDED.comment
    `, [proposalId, judgeId, text_grade, work1_grade, work2_grade, work3_grade, comment]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/evaluations/:proposalId/:judgeId", authenticate, authorize(['judge', 'admin']), async (req, res) => {
  // Security check
  if (req.user.role === 'judge' && req.user.id !== Number(req.params.judgeId)) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }
  try {
    await db.run("DELETE FROM evaluations WHERE proposal_id = ? AND judge_id = ?", [req.params.proposalId, req.params.judgeId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/admin/presentation-order", authenticate, authorize(['admin']), async (req, res) => {
  const { orders } = req.body; // Array of { proposalId, order, isParticipating, userId, roundNumber }
  
  try {
    for (const item of orders) {
      if (item.proposalId) {
        await db.run("UPDATE proposals SET presentation_order = ?, is_participating = ? WHERE id = ?", [item.order, item.isParticipating ? 1 : 0, item.proposalId]);
      } else if (item.userId && item.roundNumber) {
        // Use ON CONFLICT DO NOTHING for PostgreSQL/SQLite compatibility
        await db.run(`
          INSERT INTO proposals (user_id, round_number, student_id, name, is_participating, presentation_order)
          SELECT id, ?, student_id, name, ?, ?
          FROM users WHERE id = ?
          ON CONFLICT (user_id, round_number) DO NOTHING
        `, [item.roundNumber, item.isParticipating ? 1 : 0, item.order, item.userId]);

        await db.run(`
          UPDATE proposals SET is_participating = ?, presentation_order = ?
          WHERE user_id = ? AND round_number = ?
        `, [item.isParticipating ? 1 : 0, item.order, item.userId, item.roundNumber]);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[ADMIN] Presentation order error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Admin API
app.get("/api/admin/stats/:roundNumber", authenticate, authorize(['admin']), async (req, res) => {
  const gradeMap: Record<string, number> = {
    "A+": 99, "A0": 95, "A-": 91,
    "B+": 89, "B0": 85, "B-": 81,
    "C+": 79, "C0": 75, "C-": 71,
    "D+": 69, "D0": 65, "F": 0
  };

  const roundNum = req.params.roundNumber;

  // Get all students and their proposals for this round (if any)
  const students = await db.query(`
    SELECT u.id as user_id, u.student_id, u.name, p.id as proposal_id, p.title, p.is_submitted, p.presentation_order, p.is_participating
    FROM users u
    LEFT JOIN proposals p ON u.id = p.user_id AND p.round_number = ?
    WHERE u.role = 'student'
  `, [roundNum]) as any[];

  const stats = [];
  for (const s of students) {
    if (!s.proposal_id) {
      stats.push({
        id: null,
        user_id: s.user_id,
        student_id: s.student_id,
        name: s.name,
        title: "미제출",
        is_submitted: 0,
        is_participating: 0,
        presentation_order: 0,
        evaluations: [],
        averageScore: "0.00",
        avgText: "0.00",
        avgWork1: "0.00",
        avgWork2: "0.00",
        avgWork3: "0.00"
      });
      continue;
    }

    const evals = await db.query("SELECT text_grade, work1_grade, work2_grade, work3_grade, comment, u.name as judge_name FROM evaluations e JOIN users u ON e.judge_id = u.id WHERE proposal_id = ?", [s.proposal_id]) as any[];
    
    const processedEvals = evals.map(e => {
      const st = gradeMap[e.text_grade] || 0;
      const s1 = gradeMap[e.work1_grade] || 0;
      const s2 = gradeMap[e.work2_grade] || 0;
      const s3 = gradeMap[e.work3_grade] || 0;
      const judgeTotal = (st + s1 + s2 + s3) / 4;
      return {
        ...e,
        scores: { text: st, work1: s1, work2: s2, work3: s3 },
        totalScore: judgeTotal
      };
    });

    const numEvals = processedEvals.length;
    if (numEvals > 0) {
      const avgTotal = processedEvals.reduce((acc, e) => acc + e.totalScore, 0) / numEvals;
      const avgText = processedEvals.reduce((acc, e) => acc + e.scores.text, 0) / numEvals;
      const avgWork1 = processedEvals.reduce((acc, e) => acc + e.scores.work1, 0) / numEvals;
      const avgWork2 = processedEvals.reduce((acc, e) => acc + e.scores.work2, 0) / numEvals;
      const avgWork3 = processedEvals.reduce((acc, e) => acc + e.scores.work3, 0) / numEvals;

      stats.push({
        id: s.proposal_id,
        user_id: s.user_id,
        student_id: s.student_id,
        name: s.name,
        title: s.title || "제목 없음",
        is_submitted: s.is_submitted,
        is_participating: s.is_participating,
        presentation_order: s.presentation_order,
        evaluations: processedEvals,
        averageScore: avgTotal.toFixed(2),
        avgText: avgText.toFixed(2),
        avgWork1: avgWork1.toFixed(2),
        avgWork2: avgWork2.toFixed(2),
        avgWork3: avgWork3.toFixed(2)
      });
    } else {
      stats.push({
        id: s.proposal_id,
        user_id: s.user_id,
        student_id: s.student_id,
        name: s.name,
        title: s.title || "제목 없음",
        is_submitted: s.is_submitted,
        is_participating: s.is_participating,
        presentation_order: s.presentation_order,
        evaluations: [],
        averageScore: "0.00",
        avgText: "0.00",
        avgWork1: "0.00",
        avgWork2: "0.00",
        avgWork3: "0.00"
      });
    }
  }

  res.json(stats);
});

// Image Upload Endpoint
app.post("/api/upload", authenticate, (req, res) => {
  console.log('[UPLOAD] Received upload request');
  upload.single("image")(req, res, (err) => {
    if (err) {
      console.error('[UPLOAD] Multer error:', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: "이미지 용량이 너무 큽니다. (최대 10MB)" });
        }
        return res.status(400).json({ error: `업로드 오류: ${err.message}` });
      }
      return res.status(400).json({ error: err.message || "업로드 중 오류가 발생했습니다." });
    }

    if (!req.file) {
      console.warn('[UPLOAD] No file received');
      return res.status(400).json({ error: "파일이 없습니다." });
    }

    console.log('[UPLOAD] File uploaded successfully:', req.file.filename);
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

  // Admin API
  app.get("/api/admin/backup", authenticate, authorize(['admin']), async (req, res) => {
    try {
      const proposals = await db.query("SELECT * FROM proposals");
      const evaluations = await db.query("SELECT * FROM evaluations");
      const users = await db.query("SELECT id, username, role, name, student_id FROM users");
      res.json({ proposals, evaluations, users });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/users/bulk", authenticate, authorize(['admin']), async (req, res) => {
    const { users } = req.body;
    if (!Array.isArray(users)) {
      return res.status(400).json({ error: "잘못된 데이터 형식입니다." });
    }

    try {
      for (const u of users) {
        const initialPw = u.username;
        const hashedPassword = bcrypt.hashSync(initialPw, 10);
        const studentId = u.role === 'student' ? u.username : null;
        await db.run(`
          INSERT INTO users (username, password, role, name, student_id, needs_password_change, initial_password)
          VALUES (?, ?, ?, ?, ?, 1, ?)
        `, [u.username, hashedPassword, u.role, u.name, studentId, initialPw]);
      }
      res.json({ success: true, count: users.length });
    } catch (err) {
      console.error("[ADMIN] Bulk upload error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('[SERVER ERROR]', err);
    res.status(500).json({ error: '서버 내부 오류가 발생했습니다: ' + (err.message || String(err)) });
  });
}

startServer();

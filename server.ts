import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import pg from "pg";
import path from "path";
import fs from "fs";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

const { Pool } = pg;

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        role: string;
      };
    }
  }
}

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-this-in-production";
const IS_PROD = process.env.NODE_ENV === "production";

function createPool() {
  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }

  return new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || "postgres",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    ssl: { rejectUnauthorized: false },
  });
}

const pgPool = createPool();

const db = {
  async exec(sql: string) {
    await pgPool.query(sql);
  },
  async query(sql: string, params: any[] = []) {
    let i = 1;
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    const res = await pgPool.query(pgSql, params);
    return res.rows;
  },
  async get(sql: string, params: any[] = []) {
    let i = 1;
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    const res = await pgPool.query(pgSql, params);
    return res.rows[0] || null;
  },
  async run(sql: string, params: any[] = []) {
    let i = 1;
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    const res = await pgPool.query(pgSql, params);
    return { lastInsertRowid: null, changes: res.rowCount ?? 0 };
  },
};

const gradeMap: Record<string, number> = {
  "A+": 99,
  "A0": 95,
  "A-": 91,
  "B+": 89,
  "B0": 85,
  "B-": 81,
  "C+": 79,
  "C0": 75,
  "C-": 71,
  "D+": 69,
  "D0": 65,
  "F": 0,
};

const gradeCandidates = ["A+", "A0", "A-", "B+", "B0", "B-", "C+"];

function randomGrade() {
  return gradeCandidates[Math.floor(Math.random() * gradeCandidates.length)];
}

function hashPassword(pw: string) {
  return bcrypt.hashSync(pw, 10);
}

function isBcryptHash(value?: string | null) {
  return !!value && /^\$2[aby]\$/.test(value);
}

function verifyPassword(input: string, stored?: string | null) {
  if (!stored) return false;
  if (isBcryptHash(stored)) return bcrypt.compareSync(input, stored);
  return stored === input;
}

function normalizeBoolInt(value: any) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

function normalizeWorks(works: any[]) {
  if (!Array.isArray(works)) return [];
  return works.map((work: any, index: number) => ({
    workNumber: Number(work.workNumber ?? work.work_number ?? index + 1),
    title: work.title ?? "",
    category: work.category ?? "",
    summary: work.summary ?? "",
    keywords: work.keywords ?? "",
    purpose: work.purpose ?? "",
    effect: work.effect ?? "",
    images: Array.isArray(work.images) ? work.images : [],
  }));
}

function normalizeIsFinal(value: any, fallbackWhenUndefined = true) {
  if (value === undefined || value === null) return fallbackWhenUndefined;
  return value === true || value === "true" || value === 1 || value === "1";
}

function scoreOrNull(grade: any): number | null {
  if (grade === undefined || grade === null || grade === "") return null;
  return gradeMap[String(grade)] ?? 0;
}

function average(values: Array<number | null | undefined>) {
  const filtered = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (filtered.length === 0) return 0;
  return filtered.reduce((acc, v) => acc + v, 0) / filtered.length;
}

app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, "_").toLowerCase();
    cb(null, `${Date.now()}-${name}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = /image\/(jpeg|jpg|png|gif|webp|heic|heif)/;
    const allowedExtensions = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
    const mimetype = allowedMimeTypes.test(file.mimetype);
    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    if (mimetype || extname) return cb(null, true);
    cb(new Error(`허용되지 않는 파일 형식입니다. (MIME: ${file.mimetype}, Ext: ${path.extname(file.originalname)})`));
  },
});

const authenticate = (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (_err) {
    res.clearCookie("token");
    return res.status(401).json({ error: "인증 세션이 만료되었습니다. 다시 로그인해주세요." });
  }
};

const authorize = (roles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    next();
  };
};

async function ensureSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now(),
      username text UNIQUE NOT NULL,
      password text NOT NULL,
      role text NOT NULL,
      name text NOT NULL,
      student_id text,
      needs_password_change integer DEFAULT 1,
      initial_password text
    );

    CREATE TABLE IF NOT EXISTS rounds (
      round_number integer PRIMARY KEY,
      is_open integer DEFAULT 0,
      name text
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      round_number integer NOT NULL REFERENCES rounds(round_number) ON DELETE CASCADE,
      student_id text,
      name text,
      career_path text,
      title text,
      author text,
      genre text,
      plot text,
      subject text,
      reason text,
      is_submitted integer DEFAULT 0,
      presentation_order integer DEFAULT 0,
      is_participating integer DEFAULT 0,
      UNIQUE (user_id, round_number)
    );

    CREATE TABLE IF NOT EXISTS works (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now(),
      proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      work_number integer NOT NULL,
      title text,
      category text,
      summary text,
      keywords text,
      purpose text,
      effect text
    );

    CREATE TABLE IF NOT EXISTS work_images (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now(),
      work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      url text
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz DEFAULT now(),
      proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      judge_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text_grade text,
      work1_grade text,
      work2_grade text,
      work3_grade text,
      comment text,
      UNIQUE (proposal_id, judge_id)
    );
  `);

  await db.exec(`
    ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT false;
    ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
  `);

  // 기존 데이터 호환: 예전 시스템의 평가는 final 저장으로 간주
  await db.exec(`
    UPDATE evaluations
    SET is_final = true,
        finalized_at = COALESCE(finalized_at, created_at, now())
    WHERE is_final IS NULL OR is_final = false;
  `);

  const roundCount = await db.get("SELECT COUNT(*)::int as count FROM rounds") as any;
  if (!roundCount || Number(roundCount.count) === 0) {
    await db.run("INSERT INTO rounds (round_number, is_open, name) VALUES (?, ?, ?)", [1, 1, "졸업작품 기획 1차 심사"]);
    await db.run("INSERT INTO rounds (round_number, is_open, name) VALUES (?, ?, ?)", [2, 0, "졸업작품 기획 2차 심사"]);
    await db.run("INSERT INTO rounds (round_number, is_open, name) VALUES (?, ?, ?)", [3, 0, "졸업작품 기획 3차 심사"]);
  }

  const adminUser = await db.get("SELECT * FROM users WHERE username = ?", ["admin"]) as any;
  if (!adminUser) {
    await db.run(
      "INSERT INTO users (username, password, role, name, student_id, needs_password_change, initial_password) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["admin", hashPassword("admin123"), "admin", "관리자", null, 0, "admin123"]
    );
  } else if (!isBcryptHash(adminUser.password)) {
    await db.run("UPDATE users SET password = ?, needs_password_change = 0 WHERE username = ?", [hashPassword(adminUser.password), "admin"]);
  }

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

// Health
app.get("/api/health", async (_req, res) => {
  try {
    await db.get("SELECT 1 as ok");
    res.json({ ok: true, message: "server ok" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Auth
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE username = ?", [username]) as any;

  if (user && verifyPassword(password, user.password)) {
    const { password: _pw, ...userWithoutPassword } = user;
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: IS_PROD ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json(userWithoutPassword);
  } else {
    res.status(401).json({ error: "아이디 또는 비밀번호가 일치하지 않습니다." });
  }
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

app.post("/api/change-password", authenticate, async (req: any, res) => {
  const { userId, newPassword } = req.body;
  if (req.user.role !== "admin" && req.user.id !== userId) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  try {
    await db.run("UPDATE users SET password = ?, needs_password_change = 0 WHERE id = ?", [hashPassword(newPassword), userId]);
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: "비밀번호 변경에 실패했습니다." });
  }
});

// Admin - User Management
app.get("/api/admin/users", authenticate, authorize(["admin"]), async (_req, res) => {
  const users = await db.query("SELECT id, username, name, role, student_id, needs_password_change FROM users WHERE role != 'admin' ORDER BY created_at DESC");
  res.json(users);
});

app.get("/api/admin/rounds", authenticate, async (_req, res) => {
  const rounds = await db.query("SELECT * FROM rounds ORDER BY round_number ASC");
  res.json(rounds);
});

app.post("/api/admin/rounds/toggle", authenticate, authorize(["admin"]), async (req, res) => {
  const { roundNumber, isOpen } = req.body;
  await db.run("UPDATE rounds SET is_open = ? WHERE round_number = ?", [isOpen ? 1 : 0, roundNumber]);
  res.json({ success: true });
});

app.post("/api/admin/clear-data", authenticate, authorize(["admin"]), async (_req, res) => {
  try {
    await db.run("DELETE FROM work_images");
    await db.run("DELETE FROM works");
    await db.run("DELETE FROM evaluations");
    await db.run("DELETE FROM proposals");
    await db.run("DELETE FROM users WHERE role != 'admin'");
    res.json({ success: true });
  } catch (_err) {
    res.status(500).json({ error: "데이터 초기화 실패" });
  }
});

app.post("/api/admin/seed", authenticate, authorize(["admin"]), async (_req, res) => {
  try {
    await db.run("DELETE FROM work_images");
    await db.run("DELETE FROM works");
    await db.run("DELETE FROM evaluations");
    await db.run("DELETE FROM proposals");
    await db.run("DELETE FROM users WHERE role != 'admin'");

    const insertUserSql = "INSERT INTO users (username, password, role, name, student_id, needs_password_change, initial_password) VALUES (?, ?, ?, ?, ?, ?, ?)";
    const judges: Array<{ id: string; name: string }> = [];
    const judgeLastNames = ["김", "이", "박", "최", "정"];

    for (let i = 1; i <= 5; i++) {
      const username = `judge${String(i).padStart(2, "0")}`;
      const name = `${judgeLastNames[i - 1]}교수`;
      await db.run(insertUserSql, [username, hashPassword(username), "judge", name, null, 1, username]);
      const judge = await db.get("SELECT id FROM users WHERE username = ?", [username]) as any;
      judges.push({ id: judge.id, name });
    }

    for (let i = 1; i <= 10; i++) {
      const studentId = `2024${String(i).padStart(4, "0")}`;
      const name = ["홍길동", "김철수", "이영희", "박민수", "최수진", "오세훈", "한지민", "강서연", "윤도현", "정민아"][i - 1] || `학생${i}`;
      await db.run(insertUserSql, [studentId, hashPassword(studentId), "student", name, studentId, 1, studentId]);
      const user = await db.get("SELECT id FROM users WHERE username = ?", [studentId]) as any;
      const userId = user.id;

      for (let roundNum = 1; roundNum <= 3; roundNum++) {
        await db.run(
          `
          INSERT INTO proposals (user_id, round_number, student_id, name, career_path, title, author, genre, plot, subject, reason, is_submitted, presentation_order, is_participating)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            userId,
            roundNum,
            studentId,
            name,
            "공간 연출가",
            `졸업작품 ${i}`,
            "본인",
            "공연/전시",
            `${name}의 ${roundNum}차 줄거리`,
            `${name}의 ${roundNum}차 주제`,
            `${name}의 ${roundNum}차 기획의도`,
            1,
            i,
            1,
          ]
        );

        const proposal = await db.get("SELECT id FROM proposals WHERE user_id = ? AND round_number = ?", [userId, roundNum]) as any;
        const proposalId = proposal.id;

        for (let j = 1; j <= 3; j++) {
          await db.run(
            `
            INSERT INTO works (proposal_id, work_number, title, category, summary, keywords, purpose, effect)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              proposalId,
              j,
              `작품 ${j}`,
              "공간설계",
              `${name}의 작품 ${j} 요약`,
              "공간,무대,연출",
              "졸업작품 구현",
              "공간적 효과 제안",
            ]
          );

          const work = await db.get("SELECT id FROM works WHERE proposal_id = ? AND work_number = ?", [proposalId, j]) as any;
          await db.run("INSERT INTO work_images (work_id, url) VALUES (?, ?)", [work.id, `https://picsum.photos/seed/${studentId}-${roundNum}-${j}/800/600`]);
        }

        for (const judge of judges) {
          await db.run(
            `
            INSERT INTO evaluations (proposal_id, judge_id, text_grade, work1_grade, work2_grade, work3_grade, comment, is_final, finalized_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())
            ON CONFLICT (proposal_id, judge_id) DO UPDATE SET
              text_grade = EXCLUDED.text_grade,
              work1_grade = EXCLUDED.work1_grade,
              work2_grade = EXCLUDED.work2_grade,
              work3_grade = EXCLUDED.work3_grade,
              comment = EXCLUDED.comment,
              is_final = true,
              finalized_at = now()
            `,
            [
              proposalId,
              judge.id,
              randomGrade(),
              randomGrade(),
              randomGrade(),
              randomGrade(),
              `${roundNum}차 심사평: ${name}의 작품은 인상적입니다. (by ${judge.name})`,
              true,
            ]
          );
        }
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[ADMIN seed]", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users", authenticate, authorize(["admin"]), async (req, res) => {
  const { username, name, role, student_id } = req.body;
  try {
    await db.run(
      "INSERT INTO users (username, password, role, name, student_id, needs_password_change, initial_password) VALUES (?, ?, ?, ?, ?, 1, ?)",
      [username, hashPassword(username), role, name, student_id || null, username]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error("[ADMIN users create]", err);
    res.status(400).json({ error: "이미 존재하는 아이디입니다." });
  }
});

app.post("/api/admin/users/reset-password", authenticate, authorize(["admin"]), async (req, res) => {
  const { userId } = req.body;
  const user = await db.get("SELECT username FROM users WHERE id = ?", [userId]) as any;
  if (user) {
    await db.run("UPDATE users SET password = ?, needs_password_change = 1 WHERE id = ?", [hashPassword(user.username), userId]);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  }
});

app.delete("/api/admin/users/:id", authenticate, authorize(["admin"]), async (req, res) => {
  const userId = req.params.id;

  try {
    const user = await db.get("SELECT username, role FROM users WHERE id = ?", [userId]) as any;
    if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    if (user.username === "admin") return res.status(403).json({ error: "관리자 계정은 삭제할 수 없습니다." });

    await db.run(
      `
      DELETE FROM work_images 
      WHERE work_id IN (
        SELECT id FROM works 
        WHERE proposal_id IN (
          SELECT id FROM proposals WHERE user_id = ?
        )
      )
      `,
      [userId]
    );
    await db.run(
      `DELETE FROM works WHERE proposal_id IN (SELECT id FROM proposals WHERE user_id = ?)`,
      [userId]
    );
    await db.run(
      `DELETE FROM evaluations WHERE proposal_id IN (SELECT id FROM proposals WHERE user_id = ?)`,
      [userId]
    );
    await db.run("DELETE FROM proposals WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM evaluations WHERE judge_id = ?", [userId]);
    const result = await db.run("DELETE FROM users WHERE id = ?", [userId]);

    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "삭제할 사용자를 찾지 못했습니다." });
    }
  } catch (err: any) {
    console.error("[ADMIN] Delete user error:", err);
    res.status(500).json({ error: "사용자 삭제 중 오류가 발생했습니다: " + err.message });
  }
});

// Student API
app.post("/api/proposals", authenticate, authorize(["student", "admin"]), async (req: any, res) => {
  const { userId, roundNumber, studentId, name, careerPath, title, author, genre, plot, subject, reason, works, is_submitted } = req.body;

  if (req.user.role === "student" && req.user.id !== userId) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  const round = await db.get("SELECT is_open FROM rounds WHERE round_number = ?", [roundNumber]) as any;
  if (!round || !Number(round.is_open)) {
    return res.status(403).json({ error: "현재 심사 기간이 아닙니다." });
  }

  const existingProposal = await db.get(
    "SELECT id, is_submitted, presentation_order, is_participating FROM proposals WHERE user_id = ? AND round_number = ?",
    [userId, roundNumber]
  ) as any;

  try {
    const isSubmittedValue = normalizeBoolInt(is_submitted);

    let proposalId: string;

    if (existingProposal) {
      proposalId = existingProposal.id;

      await db.run(
        `
        UPDATE proposals
        SET student_id = ?,
            name = ?,
            career_path = ?,
            title = ?,
            author = ?,
            genre = ?,
            plot = ?,
            subject = ?,
            reason = ?,
            is_submitted = ?
        WHERE id = ?
        `,
        [
          studentId,
          name,
          careerPath,
          title,
          author,
          genre,
          plot,
          subject,
          reason,
          isSubmittedValue,
          proposalId,
        ]
      );

      const workIds = await db.query("SELECT id FROM works WHERE proposal_id = ?", [proposalId]) as any[];
      for (const w of workIds) {
        await db.run("DELETE FROM work_images WHERE work_id = ?", [w.id]);
      }
      await db.run("DELETE FROM works WHERE proposal_id = ?", [proposalId]);
    } else {
      const presentationOrder = 0;
      const isParticipating = 0;

      await db.run(
        `
        INSERT INTO proposals (user_id, round_number, student_id, name, career_path, title, author, genre, plot, subject, reason, is_submitted, presentation_order, is_participating)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [userId, roundNumber, studentId, name, careerPath, title, author, genre, plot, subject, reason, isSubmittedValue, presentationOrder, isParticipating]
      );

      const proposal = await db.get(
        "SELECT id FROM proposals WHERE user_id = ? AND round_number = ?",
        [userId, roundNumber]
      ) as any;

      proposalId = proposal.id;
    }

    for (const work of normalizeWorks(works)) {
      await db.run(
        `
        INSERT INTO works (proposal_id, work_number, title, category, summary, keywords, purpose, effect)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [proposalId, work.workNumber, work.title, work.category, work.summary, work.keywords, work.purpose, work.effect]
      );

      const workData = await db.get(
        "SELECT id FROM works WHERE proposal_id = ? AND work_number = ?",
        [proposalId, work.workNumber]
      ) as any;

      const workId = workData.id;

      for (const imgUrl of work.images) {
        await db.run("INSERT INTO work_images (work_id, url) VALUES (?, ?)", [workId, imgUrl]);
      }
    }

    res.json({ success: true, id: proposalId });
  } catch (err: any) {
    console.error("[PROPOSALS save]", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/proposals/my/:userId/:roundNumber", authenticate, async (req: any, res) => {
  if (req.user.role === "student" && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  const proposal = await db.get(
    "SELECT * FROM proposals WHERE user_id = ? AND round_number = ?",
    [req.params.userId, req.params.roundNumber]
  ) as any;

  if (proposal) {
    const works = await db.query("SELECT * FROM works WHERE proposal_id = ? ORDER BY work_number ASC", [proposal.id]) as any[];
    for (const work of works) {
      const images = await db.query("SELECT url FROM work_images WHERE work_id = ?", [work.id]) as any[];
      work.images = images.map((i: any) => i.url);
    }

    const evals = await db.query("SELECT is_final FROM evaluations WHERE proposal_id = ?", [proposal.id]) as any[];
    const isEvaluated = Array.isArray(evals)
      ? evals.some((e: any) => e.is_final === true || e.is_final === 1 || e.is_final === "1")
      : false;

    res.json({ ...proposal, works, is_evaluated: isEvaluated });
  } else {
    res.json(null);
  }
});

// Judge API
app.get("/api/students/:roundNumber", authenticate, authorize(["judge", "admin"]), async (req: any, res) => {
  const judgeId = String(req.query.judgeId || "");
  if (req.user.role === "judge" && req.user.id !== judgeId) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  const students = await db.query(
    `
    SELECT p.*, u.name as student_name, 
    (SELECT COUNT(*)::int FROM evaluations ev WHERE ev.proposal_id = p.id) as total_eval_count,
    (SELECT COUNT(*)::int FROM evaluations ev WHERE ev.proposal_id = p.id AND ev.judge_id = ?) as my_eval_count,
    e.text_grade as my_text_grade, e.work1_grade as my_work1_grade, e.work2_grade as my_work2_grade, e.work3_grade as my_work3_grade,
    e.is_final as my_is_final
    FROM proposals p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN evaluations e ON e.proposal_id = p.id AND e.judge_id = ?
    WHERE p.round_number = ? AND p.is_participating = 1
    ORDER BY p.presentation_order ASC, p.created_at ASC
    `,
    [judgeId, judgeId, req.params.roundNumber]
  );
  res.json(students);
});

app.get("/api/proposals/:id", authenticate, async (req: any, res) => {
  const judgeId = req.query.judgeId ? String(req.query.judgeId) : null;

  if (req.user.role === "judge" && req.user.id !== judgeId) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  const proposal = await db.get("SELECT * FROM proposals WHERE id = ?", [req.params.id]) as any;
  if (!proposal) {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.user.role === "student" && req.user.id !== proposal.user_id) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  proposal.careerPath = proposal.career_path;
  proposal.studentId = proposal.student_id;

  const works = await db.query("SELECT * FROM works WHERE proposal_id = ? ORDER BY work_number ASC", [proposal.id]) as any[];
  for (const work of works) {
    const images = await db.query("SELECT url FROM work_images WHERE work_id = ?", [work.id]) as any[];
    work.images = images.map((i: any) => i.url);
  }

  let evals: any[] = [];
  if (req.user.role === "admin") {
    evals = await db.query(
      `SELECT e.*, u.name as judge_name FROM evaluations e JOIN users u ON e.judge_id = u.id WHERE e.proposal_id = ?`,
      [proposal.id]
    );
  } else if (req.user.role === "judge") {
    evals = await db.query(
      `SELECT e.*, u.name as judge_name FROM evaluations e JOIN users u ON e.judge_id = u.id WHERE e.proposal_id = ? AND e.judge_id = ?`,
      [proposal.id, req.user.id]
    );
  }

  res.json({ ...proposal, works, evaluations: evals });
});

app.post("/api/evaluations", authenticate, authorize(["judge", "admin"]), async (req: any, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({ error: "관리자는 평가를 저장하거나 수정할 수 없습니다." });
  }

  const proposalId = req.body.proposalId ?? req.body.proposal_id;
  const judgeId = req.user?.id ?? req.body.judgeId ?? req.body.judge_id;
  const text_grade = req.body.text_grade;
  const work1_grade = req.body.work1_grade;
  const work2_grade = req.body.work2_grade;
  const work3_grade = req.body.work3_grade;
  const comment = req.body.comment;
  const is_final = normalizeIsFinal(req.body.is_final ?? req.body.isFinal, true);

  if (!proposalId || !judgeId) {
    return res.status(400).json({ error: "proposal 또는 judge 정보가 없습니다." });
  }

  if (req.user.role === "judge" && req.user.id !== judgeId) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  try {
    await db.run(
      `
      INSERT INTO evaluations (
        proposal_id, judge_id, text_grade, work1_grade, work2_grade, work3_grade, comment, is_final, finalized_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = true THEN now() ELSE NULL END)
      ON CONFLICT (proposal_id, judge_id) DO UPDATE SET
        text_grade  = CASE WHEN evaluations.is_final = true THEN evaluations.text_grade  ELSE EXCLUDED.text_grade  END,
        work1_grade = CASE WHEN evaluations.is_final = true THEN evaluations.work1_grade ELSE EXCLUDED.work1_grade END,
        work2_grade = CASE WHEN evaluations.is_final = true THEN evaluations.work2_grade ELSE EXCLUDED.work2_grade END,
        work3_grade = CASE WHEN evaluations.is_final = true THEN evaluations.work3_grade ELSE EXCLUDED.work3_grade END,
        comment     = CASE WHEN evaluations.is_final = true THEN evaluations.comment     ELSE EXCLUDED.comment     END,
        is_final    = CASE WHEN evaluations.is_final = true THEN true ELSE EXCLUDED.is_final END,
        finalized_at = CASE
          WHEN evaluations.is_final = true THEN evaluations.finalized_at
          WHEN EXCLUDED.is_final = true THEN now()
          ELSE NULL
        END
      `,
      [proposalId, judgeId, text_grade, work1_grade, work2_grade, work3_grade, comment, is_final, is_final]
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error("[EVALUATIONS save]", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/evaluations/:proposalId/:judgeId", authenticate, authorize(["judge", "admin"]), async (req: any, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({ error: "관리자는 평가를 삭제할 수 없습니다." });
  }

  if (req.user.role === "judge" && req.user.id !== req.params.judgeId) {
    return res.status(403).json({ error: "권한이 없습니다." });
  }

  try {
    await db.run("DELETE FROM evaluations WHERE proposal_id = ? AND judge_id = ? AND (is_final = false OR is_final IS NULL)", [
      req.params.proposalId,
      req.params.judgeId,
    ]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/presentation-order", authenticate, authorize(["admin"]), async (req, res) => {
  const { orders } = req.body;

  try {
    for (const item of orders) {
      if (item.proposalId) {
        await db.run("UPDATE proposals SET presentation_order = ?, is_participating = ? WHERE id = ?", [item.order, item.isParticipating ? 1 : 0, item.proposalId]);
      } else if (item.userId && item.roundNumber) {
        const user = await db.get("SELECT id, student_id, name FROM users WHERE id = ?", [item.userId]) as any;
        if (!user) continue;

        await db.run(
          `
          INSERT INTO proposals (user_id, round_number, student_id, name, is_participating, presentation_order)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (user_id, round_number) DO NOTHING
          `,
          [item.userId, item.roundNumber, user.student_id, user.name, item.isParticipating ? 1 : 0, item.order]
        );

        await db.run(
          `UPDATE proposals SET is_participating = ?, presentation_order = ? WHERE user_id = ? AND round_number = ?`,
          [item.isParticipating ? 1 : 0, item.order, item.userId, item.roundNumber]
        );
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[ADMIN] Presentation order error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/stats/:roundNumber", authenticate, authorize(["admin"]), async (req, res) => {
  const roundNum = req.params.roundNumber;

  const students = await db.query(
    `
    SELECT u.id as user_id, u.student_id, u.name, p.id as proposal_id, p.title, p.is_submitted, p.presentation_order, p.is_participating
    FROM users u
    LEFT JOIN proposals p ON u.id = p.user_id AND p.round_number = ?
    WHERE u.role = 'student'
    ORDER BY COALESCE(p.presentation_order, 999999), u.student_id NULLS LAST, u.created_at ASC
    `,
    [roundNum]
  ) as any[];

  const isFinalTrue = (value: any) =>
    value === true || value === 1 || value === "1";

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
        avgWork3: "0.00",
      });
      continue;
    }

    const evals = await db.query(
      `
      SELECT
        e.text_grade,
        e.work1_grade,
        e.work2_grade,
        e.work3_grade,
        e.comment,
        e.is_final,
        u.name as judge_name
      FROM evaluations e
      JOIN users u ON e.judge_id = u.id
      WHERE e.proposal_id = ?
      `,
      [s.proposal_id]
    ) as any[];

    // 핵심: 최종 저장된 평가만 통계에 포함
    const finalizedEvals = evals.filter((e: any) => isFinalTrue(e.is_final));

    const processedEvals = finalizedEvals.map((e) => {
      const st = scoreOrNull(e.text_grade);
      const s1 = scoreOrNull(e.work1_grade);
      const s2 = scoreOrNull(e.work2_grade);
      const s3 = scoreOrNull(e.work3_grade);

      // 교수 1명의 총점도 "입력된 항목만" 평균
      const judgeTotal = average([st, s1, s2, s3]);

      return {
        ...e,
        scores: {
          text: st,
          work1: s1,
          work2: s2,
          work3: s3,
        },
        totalScore: judgeTotal,
      };
    });

    // 항목별 평균: 미입력(null)은 average()에서 자동 제외
    const avgText = average(processedEvals.map((e) => e.scores.text));
    const avgWork1 = average(processedEvals.map((e) => e.scores.work1));
    const avgWork2 = average(processedEvals.map((e) => e.scores.work2));
    const avgWork3 = average(processedEvals.map((e) => e.scores.work3));

    // 전체 평균: 최종 저장된 각 교수 평가 totalScore 평균
    const avgTotal = average(processedEvals.map((e) => e.totalScore));

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
      avgWork3: avgWork3.toFixed(2),
    });
  }

  res.json(stats);
});

// Image Upload
app.post("/api/upload", authenticate, (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "이미지 용량이 너무 큽니다. (최대 10MB)" });
      }
      return res.status(400).json({ error: err.message || "업로드 중 오류가 발생했습니다." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "파일이 없습니다." });
    }

    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

app.get("/api/admin/backup", authenticate, authorize(["admin"]), async (_req, res) => {
  try {
    const proposals = await db.query("SELECT * FROM proposals");
    const works = await db.query("SELECT * FROM works");
    const work_images = await db.query("SELECT * FROM work_images");
    const evaluations = await db.query("SELECT * FROM evaluations");
    const users = await db.query("SELECT id, username, role, name, student_id FROM users");
    const rounds = await db.query("SELECT * FROM rounds");
    res.json({ proposals, works, work_images, evaluations, users, rounds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users/bulk", authenticate, authorize(["admin"]), async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) {
    return res.status(400).json({ error: "잘못된 데이터 형식입니다." });
  }

  try {
    for (const u of users) {
      const initialPw = u.username;
      await db.run(
        `
        INSERT INTO users (username, password, role, name, student_id, needs_password_change, initial_password)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        `,
        [u.username, hashPassword(initialPw), u.role, u.name, u.role === "student" ? u.username : null, initialPw]
      );
    }
    res.json({ success: true, count: users.length });
  } catch (err: any) {
    console.error("[ADMIN] Bulk upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  try {
    await pgPool.query("SELECT 1");
    console.log("PostgreSQL connected");
    await ensureSchema();
  } catch (err) {
    console.error("DB connection failed:", err);
    process.exit(1);
  }

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[SERVER ERROR]", err);
    res.status(500).json({ error: "서버 내부 오류가 발생했습니다: " + (err.message || String(err)) });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

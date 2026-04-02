// server.ts
import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

// ──────────────────────────────────────────────
// 1. 환경변수 필수 검증
// ──────────────────────────────────────────────
const REQUIRED_ENV = [
  "JWT_SECRET",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] 환경변수 '${key}'가 설정되지 않았습니다. 서버를 종료합니다.`);
    process.exit(1);
  }
}

const JWT_SECRET = process.env.JWT_SECRET as string;
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "work-images";

// ──────────────────────────────────────────────
// 2. DB / Supabase 클라이언트 초기화
// ──────────────────────────────────────────────
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// ──────────────────────────────────────────────
// 3. 등급 → 점수 맵 및 scoreOrNull 헬퍼
// ──────────────────────────────────────────────
const gradeMap: Record<string, number> = {
  "A+": 99, "A0": 95, "A-": 91,
  "B+": 89, "B0": 85, "B-": 81,
  "C+": 79, "C0": 75, "C-": 71,
  "D+": 69, "D0": 65, "F": 0,
};

function scoreOrNull(grade: string | null | undefined): number | null {
  if (grade === undefined || grade === null || grade.trim() === "") return null;
  const trimmed = grade.trim();
  if (Object.prototype.hasOwnProperty.call(gradeMap, trimmed)) {
    return gradeMap[trimmed];
  }
  return null;
}

// ──────────────────────────────────────────────
// 4. 유틸 함수
// ──────────────────────────────────────────────
function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function roundTwo(n: number): number {
  return Math.round(n * 100) / 100;
}

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

function normalizeBoolean(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val === "true" || val === "1";
  return Boolean(val);
}

function normalizeWorks(raw: unknown): Array<{ title: string; description: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w) => w && typeof w === "object")
    .map((w: any) => ({
      title: String(w.title ?? "").trim(),
      description: String(w.description ?? "").trim(),
    }));
}

// ──────────────────────────────────────────────
// 5. 스키마 초기화
// ──────────────────────────────────────────────
async function ensureSchema(): Promise<void> {
  await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username    TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      name        TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'student',
      department  TEXT,
      student_id  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS rounds (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      round_number INT UNIQUE NOT NULL,
      is_active    BOOLEAN NOT NULL DEFAULT FALSE,
      name         TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS proposals (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      round_number INT NOT NULL,
      title        TEXT NOT NULL,
      content      TEXT,
      is_final     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS works (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS work_images (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      work_id     UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      url         TEXT NOT NULL,
      order_index INT NOT NULL DEFAULT 0
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS evaluations (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      judge_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text_grade  VARCHAR(5),
      work1_grade VARCHAR(5),
      work2_grade VARCHAR(5),
      work3_grade VARCHAR(5),
      comment     TEXT,
      is_final    BOOLEAN NOT NULL DEFAULT FALSE,
      total_score NUMERIC(5,2),
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(proposal_id, judge_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS presentation_orders (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      round_number INT NOT NULL,
      proposal_id  UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      order_index  INT NOT NULL DEFAULT 0,
      UNIQUE(round_number, proposal_id)
    )
  `);

  // 초기 관리자 계정
  const adminExists = await db.query(
    "SELECT id FROM users WHERE username = $1", ["admin"]
  );
  if (adminExists.rows.length === 0) {
    const hashed = await hashPassword("admin1234");
    await db.query(
      "INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)",
      ["admin", hashed, "관리자", "admin"]
    );
  }

  // 기본 라운드 1~3
  for (let i = 1; i <= 3; i++) {
    const exists = await db.query(
      "SELECT 1 FROM rounds WHERE round_number = $1", [i]
    );
    if (exists.rows.length === 0) {
      await db.query(
        "INSERT INTO rounds (round_number, is_active, name) VALUES ($1, $2, $3)",
        [i, i === 1, `${i}차 심사`]
      );
    }
  }
}

// ──────────────────────────────────────────────
// 6. Express 앱 설정
// ──────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("이미지 파일(jpg, png, gif, webp)만 업로드 가능합니다."));
    }
  },
});

// ──────────────────────────────────────────────
// 7. 미들웨어: 인증 / 관리자 권한
// ──────────────────────────────────────────────
interface AuthenticatedRequest extends Request {
  user?: { id: string; username: string; role: string; name: string };
}

function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token =
    req.cookies?.token ??
    req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "인증이 필요합니다." });
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedRequest["user"];
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "유효하지 않은 토큰입니다." });
  }
}

function adminMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "관리자 권한이 필요합니다." });
    return;
  }
  next();
}

// ──────────────────────────────────────────────
// 8. 인증 라우트
// [수정] /api/auth/login, /api/auth/logout 으로 통일
// 하위 호환을 위해 /api/login, /api/logout 도 유지
// ──────────────────────────────────────────────
async function handleLogin(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body as {
    username?: string;
    password?: string;
  };
  if (!username || !password) {
    res.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });
    return;
  }
  try {
    const result = await db.query(
      "SELECT id, username, password, name, role, student_id FROM users WHERE username = $1",
      [username.trim()]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
      return;
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
      return;
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
    res
      .cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000,
      })
      .json({
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        student_id: user.student_id,
      });
  } catch {
    res.status(500).json({ error: "로그인 처리 중 오류가 발생했습니다." });
  }
}

function handleLogout(_req: Request, res: Response): void {
  res.clearCookie("token").json({ success: true });
}

// 프론트에서 사용하는 경로 + 정규 경로 모두 등록
app.post("/api/login", handleLogin);
app.post("/api/auth/login", handleLogin);
app.post("/api/logout", handleLogout);
app.post("/api/auth/logout", handleLogout);

app.get("/api/health", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  res.json(req.user);
});

// ──────────────────────────────────────────────
// 9. 비밀번호 변경
// [추가] /api/change-password 엔드포인트 신규 구현
// ──────────────────────────────────────────────
app.post(
  "/api/change-password",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const { userId, newPassword } = req.body as {
      userId?: string;
      newPassword?: string;
    };

    // 본인이거나 관리자만 허용
    if (user.id !== userId && user.role !== "admin") {
      res.status(403).json({ error: "권한이 없습니다." });
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      res.status(400).json({ error: "비밀번호는 4자 이상이어야 합니다." });
      return;
    }
    try {
      const hashed = await hashPassword(newPassword);
      await db.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, userId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "비밀번호 변경에 실패했습니다." });
    }
  }
);

// ──────────────────────────────────────────────
// 10. 관리자: 사용자 CRUD
// ──────────────────────────────────────────────
app.get(
  "/api/admin/users",
  authMiddleware,
  adminMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT id, username, name, role, department, student_id, created_at
         FROM users ORDER BY created_at ASC`
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "사용자 목록 조회에 실패했습니다." });
    }
  }
);

app.post(
  "/api/admin/users",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { username, password, name, role, department, student_id } =
      req.body as Record<string, string>;
    if (!username || !name || !role) {
      res.status(400).json({ error: "필수 항목(username, name, role)을 입력하세요." });
      return;
    }
    try {
      // 비밀번호 미입력 시 username을 초기 비밀번호로 사용
      const initialPassword = password || username;
      const hashed = await hashPassword(initialPassword);
      const result = await db.query(
        `INSERT INTO users (username, password, name, role, department, student_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, name, role, department, student_id, created_at`,
        [username.trim(), hashed, name.trim(), role, department ?? null, student_id ?? null]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "이미 존재하는 아이디입니다." });
      } else {
        res.status(500).json({ error: "사용자 생성에 실패했습니다." });
      }
    }
  }
);

app.put(
  "/api/admin/users/:id",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, role, department, student_id, password } =
      req.body as Record<string, string>;
    try {
      if (password) {
        const hashed = await hashPassword(password);
        await db.query(
          `UPDATE users SET name=$1, role=$2, department=$3, student_id=$4, password=$5 WHERE id=$6`,
          [name, role, department ?? null, student_id ?? null, hashed, id]
        );
      } else {
        await db.query(
          `UPDATE users SET name=$1, role=$2, department=$3, student_id=$4 WHERE id=$5`,
          [name, role, department ?? null, student_id ?? null, id]
        );
      }
      const updated = await db.query(
        `SELECT id, username, name, role, department, student_id, created_at FROM users WHERE id = $1`,
        [id]
      );
      if (updated.rows.length === 0) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
        return;
      }
      res.json(updated.rows[0]);
    } catch {
      res.status(500).json({ error: "사용자 수정에 실패했습니다." });
    }
  }
);

app.delete(
  "/api/admin/users/:id",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      await db.query("DELETE FROM users WHERE id = $1", [id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "사용자 삭제에 실패했습니다." });
    }
  }
);

// 관리자: 비밀번호 초기화 (아이디로 재설정)
app.post(
  "/api/admin/users/reset-password",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) {
      res.status(400).json({ error: "userId가 필요합니다." });
      return;
    }
    try {
      const userResult = await db.query(
        "SELECT username FROM users WHERE id = $1", [userId]
      );
      if (userResult.rows.length === 0) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
        return;
      }
      const hashed = await hashPassword(userResult.rows[0].username);
      await db.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, userId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "비밀번호 초기화에 실패했습니다." });
    }
  }
);

// 대량 사용자 생성
app.post(
  "/api/admin/users/bulk",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { users } = req.body as {
      users?: Array<{
        username: string; password?: string; name: string;
        role: string; department?: string; student_id?: string;
      }>;
    };
    if (!Array.isArray(users) || users.length === 0) {
      res.status(400).json({ error: "사용자 배열이 필요합니다." });
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const created: unknown[] = [];
      for (const u of users) {
        if (!u.username || !u.name || !u.role) continue;
        const initialPassword = u.password || u.username;
        const hashed = await hashPassword(initialPassword);
        const result = await client.query(
          `INSERT INTO users (username, password, name, role, department, student_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (username) DO NOTHING
           RETURNING id, username, name, role, department, student_id`,
          [u.username.trim(), hashed, u.name.trim(), u.role, u.department ?? null, u.student_id ?? null]
        );
        if (result.rows.length > 0) created.push(result.rows[0]);
      }
      await client.query("COMMIT");
      res.status(201).json({ created: created.length, users: created });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "대량 사용자 생성에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────
// 11. 관리자: 라운드 CRUD
// [수정] 프론트가 사용하는 /api/admin/rounds/toggle POST 추가
// ──────────────────────────────────────────────
app.get(
  "/api/admin/rounds",
  authMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM rounds ORDER BY round_number ASC");
      // is_open 필드 추가 (is_active 의 별칭)
      const rows = result.rows.map(r => ({ ...r, is_open: r.is_active }));
      res.json(rows);
    } catch {
      res.status(500).json({ error: "라운드 목록 조회에 실패했습니다." });
    }
  }
);

app.post(
  "/api/admin/rounds",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { round_number, name, is_active } = req.body as {
      round_number?: number; name?: string; is_active?: boolean;
    };
    if (round_number === undefined) {
      res.status(400).json({ error: "round_number가 필요합니다." });
      return;
    }
    try {
      const result = await db.query(
        `INSERT INTO rounds (round_number, name, is_active) VALUES ($1, $2, $3) RETURNING *`,
        [round_number, name ?? `${round_number}차 심사`, normalizeBoolean(is_active)]
      );
      res.status(201).json({ ...result.rows[0], is_open: result.rows[0].is_active });
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "이미 존재하는 라운드 번호입니다." });
      } else {
        res.status(500).json({ error: "라운드 생성에 실패했습니다." });
      }
    }
  }
);

// [수정] 프론트가 사용하는 POST /api/admin/rounds/toggle 추가
app.post(
  "/api/admin/rounds/toggle",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { roundNumber, isOpen } = req.body as {
      roundNumber?: number; isOpen?: boolean;
    };
    if (roundNumber === undefined) {
      res.status(400).json({ error: "roundNumber가 필요합니다." });
      return;
    }
    try {
      const updated = await db.query(
        "UPDATE rounds SET is_active = $1 WHERE round_number = $2 RETURNING *",
        [normalizeBoolean(isOpen), roundNumber]
      );
      if (updated.rows.length === 0) {
        res.status(404).json({ error: "라운드를 찾을 수 없습니다." });
        return;
      }
      res.json({ ...updated.rows[0], is_open: updated.rows[0].is_active });
    } catch {
      res.status(500).json({ error: "라운드 토글에 실패했습니다." });
    }
  }
);

// 기존 PATCH /:id/toggle 도 유지
app.patch(
  "/api/admin/rounds/:id/toggle",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const current = await db.query("SELECT id, is_active FROM rounds WHERE id = $1", [id]);
      if (current.rows.length === 0) {
        res.status(404).json({ error: "라운드를 찾을 수 없습니다." });
        return;
      }
      const updated = await db.query(
        "UPDATE rounds SET is_active = $1 WHERE id = $2 RETURNING *",
        [!current.rows[0].is_active, id]
      );
      res.json({ ...updated.rows[0], is_open: updated.rows[0].is_active });
    } catch {
      res.status(500).json({ error: "라운드 토글에 실패했습니다." });
    }
  }
);

app.delete(
  "/api/admin/rounds/:id",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      await db.query("DELETE FROM rounds WHERE id = $1", [id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "라운드 삭제에 실패했습니다." });
    }
  }
);

// ──────────────────────────────────────────────
// 12. 관리자: 통계
// ──────────────────────────────────────────────
app.get(
  "/api/admin/stats/:roundNumber",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const roundNumber = parseInt(req.params.roundNumber, 10);
    if (isNaN(roundNumber)) {
      res.status(400).json({ error: "유효한 roundNumber가 필요합니다." });
      return;
    }
    try {
      const proposalsResult = await db.query(
        `SELECT p.id, p.title, p.is_final,
                u.id AS student_id, u.name AS student_name, u.student_id AS student_no
         FROM proposals p
         JOIN users u ON u.id = p.student_id
         WHERE p.round_number = $1
         ORDER BY u.name ASC`,
        [roundNumber]
      );
      const proposals = proposalsResult.rows;
      if (proposals.length === 0) { res.json([]); return; }

      const proposalIds = proposals.map((p) => p.id);
      const evaluationsResult = await db.query(
        `SELECT e.proposal_id, e.judge_id, e.total_score, e.is_final,
                e.text_grade, e.work1_grade, e.work2_grade, e.work3_grade,
                u.name AS judge_name
         FROM evaluations e
         JOIN users u ON u.id = e.judge_id
         WHERE e.proposal_id = ANY($1::uuid[])`,
        [proposalIds]
      );

      const evalMap = new Map<string, typeof evaluationsResult.rows>();
      for (const e of evaluationsResult.rows) {
        if (!evalMap.has(e.proposal_id)) evalMap.set(e.proposal_id, []);
        evalMap.get(e.proposal_id)!.push(e);
      }

      const stats = proposals.map((p) => {
        const evals = evalMap.get(p.id) ?? [];
        const scoredEvals = evals.filter((e) => e.total_score != null);
        const avgScore =
          scoredEvals.length > 0
            ? roundTwo(average(scoredEvals.map((e) => parseFloat(e.total_score))))
            : null;
        return {
          proposalId: p.id,
          proposalTitle: p.title,
          isFinal: p.is_final,
          studentId: p.student_id,
          studentName: p.student_name,
          studentNo: p.student_no,
          evaluationCount: evals.length,
          finalEvaluationCount: evals.filter((e) => e.is_final).length,
          averageScore: avgScore,
          judges: evals.map((e) => ({
            judgeId: e.judge_id,
            judgeName: e.judge_name,
            totalScore: e.total_score != null ? parseFloat(e.total_score) : null,
            isFinal: e.is_final,
          })),
        };
      });
      res.json(stats);
    } catch {
      res.status(500).json({ error: "통계 조회에 실패했습니다." });
    }
  }
);

// ──────────────────────────────────────────────
// 13. 관리자: 데이터 초기화
// ──────────────────────────────────────────────
app.post(
  "/api/admin/clear-data",
  authMiddleware,
  adminMiddleware,
  async (_req: Request, res: Response) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const imagesResult = await client.query("SELECT url FROM work_images");
      const urls = imagesResult.rows.map((r: any) =>
        r.url.split("/").slice(-2).join("/")
      );
      if (urls.length > 0) {
        await supabase.storage.from(STORAGE_BUCKET).remove(urls);
      }
      await client.query("DELETE FROM presentation_orders");
      await client.query("DELETE FROM evaluations");
      await client.query("DELETE FROM work_images");
      await client.query("DELETE FROM works");
      await client.query("DELETE FROM proposals");
      await client.query("COMMIT");
      res.json({ success: true });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "데이터 초기화에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────
// 14. 관리자: 시드 데이터
// ──────────────────────────────────────────────
app.post(
  "/api/admin/seed",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { roundNumber = 1 } = req.body as { roundNumber?: number };
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const studentsResult = await client.query(
        "SELECT id, name FROM users WHERE role = 'student'"
      );
      const students = studentsResult.rows;
      for (const student of students) {
        const existing = await client.query(
          "SELECT id FROM proposals WHERE student_id = $1 AND round_number = $2",
          [student.id, roundNumber]
        );
        if (existing.rows.length > 0) continue;
        await client.query(
          `INSERT INTO proposals (student_id, round_number, title, content)
           VALUES ($1, $2, $3, $4)`,
          [student.id, roundNumber, `${student.name}의 기획안`, "시드 데이터로 생성된 기획안입니다."]
        );
      }
      await client.query("COMMIT");
      res.json({ success: true, seeded: students.length });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "시드 데이터 생성에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────
// 15. 관리자: 백업
// ──────────────────────────────────────────────
app.get(
  "/api/admin/backup",
  authMiddleware,
  adminMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const [usersRes, roundsRes, proposalsRes, evalsRes] = await Promise.all([
        db.query("SELECT id, username, name, role, department, student_id, created_at FROM users"),
        db.query("SELECT * FROM rounds ORDER BY round_number"),
        db.query(`
          SELECT p.*, u.name AS student_name, u.student_id AS student_no
          FROM proposals p JOIN users u ON u.id = p.student_id
          ORDER BY p.round_number, u.name
        `),
        db.query(`
          SELECT e.*, u.name AS judge_name, p.title AS proposal_title
          FROM evaluations e
          JOIN users u ON u.id = e.judge_id
          JOIN proposals p ON p.id = e.proposal_id
          ORDER BY e.updated_at DESC
        `),
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(usersRes.rows), "Users");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(roundsRes.rows), "Rounds");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(proposalsRes.rows), "Proposals");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(evalsRes.rows), "Evaluations");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const filename = `backup_${new Date().toISOString().slice(0, 10)}.xlsx`;
      res
        .setHeader("Content-Disposition", `attachment; filename="${filename}"`)
        .setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(buffer);
    } catch {
      res.status(500).json({ error: "백업 생성에 실패했습니다." });
    }
  }
);

// ──────────────────────────────────────────────
// 16. 기획안 라우트
// [수정] 프론트가 사용하는 /api/proposals/my/:userId/:roundNumber 추가
// [추가] /api/proposals/reference/:userId/:roundNumber (이전 차수 참조)
// ──────────────────────────────────────────────

// [추가] 이전 차수 기획안 참조 - 반드시 동적 라우트보다 앞에 위치해야 함
app.get(
  "/api/proposals/reference/:userId/:roundNumber",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, roundNumber } = req.params;
    const user = req.user!;

    // 본인이거나 심사위원/관리자만 허용
    if (user.id !== userId && user.role === "student") {
      res.status(403).json({ error: "권한이 없습니다." });
      return;
    }
    try {
      const result = await db.query(
        `SELECT p.*, u.name, u.student_id AS student_no
         FROM proposals p
         JOIN users u ON u.id = p.student_id
         WHERE p.student_id = $1 AND p.round_number = $2
         LIMIT 1`,
        [userId, parseInt(roundNumber, 10)]
      );
      if (result.rows.length === 0) {
        res.json(null);
        return;
      }
      const proposal = result.rows[0];

      // works 포함
      const worksResult = await db.query(
        `SELECT w.*, array_agg(wi.url ORDER BY wi.order_index) FILTER (WHERE wi.url IS NOT NULL) AS images
         FROM works w
         LEFT JOIN work_images wi ON wi.work_id = w.id
         WHERE w.proposal_id = $1
         GROUP BY w.id ORDER BY w.id`,
        [proposal.id]
      );
      res.json({ ...proposal, works: worksResult.rows });
    } catch {
      res.status(500).json({ error: "이전 차수 기획안 조회에 실패했습니다." });
    }
  }
);

// [추가] 학생 본인 기획안 조회
app.get(
  "/api/proposals/my/:userId/:roundNumber",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, roundNumber } = req.params;
    const user = req.user!;

    if (user.id !== userId && user.role !== "admin") {
      res.status(403).json({ error: "권한이 없습니다." });
      return;
    }
    try {
      const result = await db.query(
        `SELECT p.*, u.name, u.student_id
         FROM proposals p
         JOIN users u ON u.id = p.student_id
         WHERE p.student_id = $1 AND p.round_number = $2
         LIMIT 1`,
        [userId, parseInt(roundNumber, 10)]
      );
      if (result.rows.length === 0) {
        res.json(null);
        return;
      }
      const proposal = result.rows[0];
      const worksResult = await db.query(
        `SELECT w.*, array_agg(wi.url ORDER BY wi.order_index) FILTER (WHERE wi.url IS NOT NULL) AS images
         FROM works w
         LEFT JOIN work_images wi ON wi.work_id = w.id
         WHERE w.proposal_id = $1
         GROUP BY w.id ORDER BY w.id`,
        [proposal.id]
      );
      res.json({ ...proposal, works: worksResult.rows });
    } catch {
      res.status(500).json({ error: "기획안 조회에 실패했습니다." });
    }
  }
);

// 라운드별 기획안 목록
app.get(
  "/api/proposals/:roundNumber",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const roundNumber = parseInt(req.params.roundNumber, 10);
    const user = req.user!;
    if (isNaN(roundNumber)) {
      res.status(400).json({ error: "유효한 roundNumber가 필요합니다." });
      return;
    }
    try {
      let result;
      if (user.role === "student") {
        result = await db.query(
          `SELECT p.*, u.name AS student_name
           FROM proposals p JOIN users u ON u.id = p.student_id
           WHERE p.round_number = $1 AND p.student_id = $2`,
          [roundNumber, user.id]
        );
      } else {
        result = await db.query(
          `SELECT p.*, u.name AS student_name, u.student_id AS student_no
           FROM proposals p JOIN users u ON u.id = p.student_id
           WHERE p.round_number = $1 ORDER BY u.name ASC`,
          [roundNumber]
        );
      }
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "기획안 목록 조회에 실패했습니다." });
    }
  }
);

app.post(
  "/api/proposals",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const { round_number, title, content, works: rawWorks } = req.body as {
      round_number?: number; title?: string; content?: string; works?: unknown;
    };
    if (!round_number || !title) {
      res.status(400).json({ error: "round_number와 title이 필요합니다." });
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const proposalRes = await client.query(
        `INSERT INTO proposals (student_id, round_number, title, content)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [user.id, round_number, title.trim(), content ?? null]
      );
      const proposal = proposalRes.rows[0];
      const worksData = normalizeWorks(rawWorks);
      for (const w of worksData) {
        await client.query(
          "INSERT INTO works (proposal_id, title, description) VALUES ($1, $2, $3)",
          [proposal.id, w.title, w.description]
        );
      }
      await client.query("COMMIT");
      res.status(201).json(proposal);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "기획안 생성에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/proposals/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const { id } = req.params;
    const { title, content, works: rawWorks } = req.body as {
      title?: string; content?: string; works?: unknown;
    };
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id, student_id, is_final, title FROM proposals WHERE id = $1", [id]
      );
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "기획안을 찾을 수 없습니다." });
        return;
      }
      const proposal = existing.rows[0];
      if (user.role !== "admin" && proposal.student_id !== user.id) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "수정 권한이 없습니다." });
        return;
      }
      if (proposal.is_final && user.role !== "admin") {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "최종 제출된 기획안은 수정할 수 없습니다." });
        return;
      }
      await client.query(
        "UPDATE proposals SET title = $1, content = $2, updated_at = NOW() WHERE id = $3",
        [title ?? proposal.title, content ?? null, id]
      );
      const worksData = normalizeWorks(rawWorks);
      if (worksData.length > 0) {
        const existingWorks = await client.query(
          "SELECT id FROM works WHERE proposal_id = $1", [id]
        );
        const workIds = existingWorks.rows.map((w: any) => w.id);
        if (workIds.length > 0) {
          await client.query(
            "DELETE FROM work_images WHERE work_id = ANY($1::uuid[])", [workIds]
          );
        }
        await client.query("DELETE FROM works WHERE proposal_id = $1", [id]);
        for (const w of worksData) {
          await client.query(
            "INSERT INTO works (proposal_id, title, description) VALUES ($1, $2, $3)",
            [id, w.title, w.description]
          );
        }
      }
      const updated = await client.query("SELECT * FROM proposals WHERE id = $1", [id]);
      await client.query("COMMIT");
      res.json(updated.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "기획안 수정에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────
// 17. 이미지 업로드
// [수정] /api/upload 경로 추가 (프론트에서 사용)
// ──────────────────────────────────────────────
async function handleImageUpload(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workId } = req.params;
  if (!req.file) {
    res.status(400).json({ error: "이미지 파일이 필요합니다." });
    return;
  }
  try {
    const ext = req.file.originalname.split(".").pop()?.toLowerCase() ?? "jpg";
    const folder = workId ?? `general/${req.user!.id}`;
    const filename = `${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filename, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });
    if (error) {
      res.status(500).json({ error: "이미지 업로드에 실패했습니다." });
      return;
    }
    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename);

    if (workId) {
      const result = await db.query(
        "INSERT INTO work_images (work_id, url) VALUES ($1, $2) RETURNING *",
        [workId, urlData.publicUrl]
      );
      res.status(201).json(result.rows[0]);
    } else {
      res.status(201).json({ url: urlData.publicUrl });
    }
  } catch {
    res.status(500).json({ error: "이미지 처리 중 오류가 발생했습니다." });
  }
}

// 기존 경로
app.post("/api/works/:workId/images", authMiddleware, upload.single("image"), handleImageUpload);
// [추가] 프론트에서 사용하는 /api/upload 경로
app.post("/api/upload", authMiddleware, upload.single("image"), (req: AuthenticatedRequest, res: Response) => {
  req.params.workId = req.body.workId ?? "";
  handleImageUpload(req, res);
});

// ──────────────────────────────────────────────
// 18. 평가 라우트
// [수정] 프론트가 proposalId로 보내는 필드명 처리
// ──────────────────────────────────────────────
app.get(
  "/api/evaluations/:proposalId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const { proposalId } = req.params;
    try {
      let result;
      if (user.role === "admin") {
        result = await db.query(
          `SELECT e.*, u.name AS judge_name
           FROM evaluations e JOIN users u ON u.id = e.judge_id
           WHERE e.proposal_id = $1`,
          [proposalId]
        );
      } else {
        result = await db.query(
          "SELECT * FROM evaluations WHERE proposal_id = $1 AND judge_id = $2",
          [proposalId, user.id]
        );
      }
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "평가 조회에 실패했습니다." });
    }
  }
);

app.post(
  "/api/evaluations",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    // [수정] proposalId / proposal_id 둘 다 허용
    const {
      proposalId,
      proposal_id,
      judgeId,
      text_grade,
      work1_grade,
      work2_grade,
      work3_grade,
      comment,
      is_final,
    } = req.body as {
      proposalId?: string;
      proposal_id?: string;
      judgeId?: string;
      text_grade?: string;
      work1_grade?: string;
      work2_grade?: string;
      work3_grade?: string;
      comment?: string;
      is_final?: boolean;
    };

    const finalProposalId = proposalId ?? proposal_id;
    if (!finalProposalId) {
      res.status(400).json({ error: "proposal_id가 필요합니다." });
      return;
    }

    const scoreValues = [text_grade, work1_grade, work2_grade, work3_grade]
      .map((g) => scoreOrNull(g))
      .filter((v): v is number => v !== null);
    const totalScore = scoreValues.length > 0 ? roundTwo(average(scoreValues)) : null;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id, is_final FROM evaluations WHERE proposal_id = $1 AND judge_id = $2",
        [finalProposalId, user.id]
      );

      let result;
      if (existing.rows.length > 0) {
        if (existing.rows[0].is_final && user.role !== "admin") {
          await client.query("ROLLBACK");
          res.status(403).json({ error: "최종 제출된 평가는 수정할 수 없습니다." });
          return;
        }
        result = await client.query(
          `UPDATE evaluations
           SET text_grade=$1, work1_grade=$2, work2_grade=$3, work3_grade=$4,
               comment=$5, total_score=$6, is_final=$7, updated_at=NOW()
           WHERE proposal_id=$8 AND judge_id=$9 RETURNING *`,
          [
            text_grade ?? null, work1_grade ?? null,
            work2_grade ?? null, work3_grade ?? null,
            comment ?? null, totalScore,
            is_final ?? existing.rows[0].is_final,
            finalProposalId, user.id,
          ]
        );
      } else {
        result = await client.query(
          `INSERT INTO evaluations
             (proposal_id, judge_id, text_grade, work1_grade, work2_grade, work3_grade,
              comment, total_score, is_final)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            finalProposalId, user.id,
            text_grade ?? null, work1_grade ?? null,
            work2_grade ?? null, work3_grade ?? null,
            comment ?? null, totalScore, is_final ?? false,
          ]
        );
      }
      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "평가 저장에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/evaluations/:proposalId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const { proposalId } = req.params;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id, is_final FROM evaluations WHERE proposal_id = $1 AND judge_id = $2",
        [proposalId, user.id]
      );
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "평가를 찾을 수 없습니다." });
        return;
      }
      if (existing.rows[0].is_final && user.role !== "admin") {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "최종 제출된 평가는 삭제할 수 없습니다." });
        return;
      }
      await client.query(
        "DELETE FROM evaluations WHERE proposal_id = $1 AND judge_id = $2",
        [proposalId, user.id]
      );
      await client.query("COMMIT");
      res.json({ success: true });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "평가 삭제에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/evaluations/:proposalId/:judgeId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const requester = req.user!;
    const { proposalId, judgeId } = req.params;
    if (requester.role !== "admin" && requester.id !== judgeId) {
      res.status(403).json({ error: "권한이 없습니다." });
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id, is_final FROM evaluations WHERE proposal_id = $1 AND judge_id = $2",
        [proposalId, judgeId]
      );
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "평가를 찾을 수 없습니다." });
        return;
      }
      if (existing.rows[0].is_final && requester.role !== "admin") {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "최종 제출된 평가는 삭제할 수 없습니다." });
        return;
      }
      await client.query(
        "DELETE FROM evaluations WHERE proposal_id = $1 AND judge_id = $2",
        [proposalId, judgeId]
      );
      await client.query("COMMIT");
      res.json({ success: true });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "평가 삭제에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────
// 19. 관리자: 제출안 초기화
// ──────────────────────────────────────────────
app.delete(
  "/api/admin/proposals/:proposalId/reset",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { proposalId } = req.params;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const proposalResult = await client.query(
        "SELECT id FROM proposals WHERE id = $1", [proposalId]
      );
      if (proposalResult.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "기획안을 찾을 수 없습니다." });
        return;
      }
      const worksResult = await client.query(
        "SELECT id FROM works WHERE proposal_id = $1", [proposalId]
      );
      const workIds = worksResult.rows.map((w: any) => w.id);
      if (workIds.length > 0) {
        const urlResult = await client.query(
          "SELECT url FROM work_images WHERE work_id = ANY($1::uuid[])", [workIds]
        );
        const paths = urlResult.rows.map((r: any) =>
          r.url.split("/").slice(-2).join("/")
        );
        if (paths.length > 0) {
          await supabase.storage.from(STORAGE_BUCKET).remove(paths);
        }
        await client.query(
          "DELETE FROM work_images WHERE work_id = ANY($1::uuid[])", [workIds]
        );
      }
      await client.query("DELETE FROM evaluations WHERE proposal_id = $1", [proposalId]);
      await client.query("DELETE FROM works WHERE proposal_id = $1", [proposalId]);
      await client.query("DELETE FROM proposals WHERE id = $1", [proposalId]);
      await client.query("COMMIT");
      res.json({ success: true });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "제출안 초기화에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────
// 20. 발표 순서 관리
// [수정] 프론트가 사용하는 POST /api/admin/presentation-order 처리
// ──────────────────────────────────────────────
app.get(
  "/api/admin/presentation-order/:roundNumber",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const roundNumber = parseInt(req.params.roundNumber, 10);
    try {
      const result = await db.query(
        `SELECT po.*, p.title, u.name AS student_name, u.student_id AS student_no
         FROM presentation_orders po
         JOIN proposals p ON p.id = po.proposal_id
         JOIN users u ON u.id = p.student_id
         WHERE po.round_number = $1
         ORDER BY po.order_index ASC`,
        [roundNumber]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "발표 순서 조회에 실패했습니다." });
    }
  }
);

app.post(
  "/api/admin/presentation-order",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    // [수정] orders 배열 안의 roundNumber 또는 최상위 round_number 둘 다 허용
    const { round_number, orders } = req.body as {
      round_number?: number;
      orders?: Array<{
        proposalId?: string | null;
        proposal_id?: string | null;
        order: number;
        roundNumber?: number;
      }>;
    };
    if (!Array.isArray(orders) || orders.length === 0) {
      res.status(400).json({ error: "orders 배열이 필요합니다." });
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const o of orders) {
        const rn = o.roundNumber ?? round_number;
        const pid = o.proposalId ?? o.proposal_id;
        if (!rn || !pid) continue;
        await client.query(
          `INSERT INTO presentation_orders (round_number, proposal_id, order_index)
           VALUES ($1, $2, $3)
           ON CONFLICT (round_number, proposal_id)
           DO UPDATE SET order_index = EXCLUDED.order_index`,
          [rn, pid, o.order]
        );
      }
      await client.query("COMMIT");
      res.json({ success: true });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "발표 순서 저장에 실패했습니다." });
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────
// 21. 심사위원: 학생 목록 조회
// ──────────────────────────────────────────────
app.get(
  "/api/judge/students",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    if (user.role !== "judge" && user.role !== "admin") {
      res.status(403).json({ error: "심사위원 권한이 필요합니다." });
      return;
    }
    const roundNumber = parseInt(req.query.roundNumber as string, 10);
    if (isNaN(roundNumber)) {
      res.status(400).json({ error: "유효한 roundNumber가 필요합니다." });
      return;
    }
    try {
      const result = await db.query(
        `SELECT u.id, u.name, u.student_id AS student_no, u.department,
                p.id AS proposal_id, p.title AS proposal_title, p.is_final,
                e.id AS evaluation_id, e.is_final AS evaluation_final, e.total_score
         FROM proposals p
         JOIN users u ON u.id = p.student_id
         LEFT JOIN evaluations e ON e.proposal_id = p.id AND e.judge_id = $1
         WHERE p.round_number = $2
         ORDER BY u.name ASC`,
        [user.id, roundNumber]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: "학생 목록 조회에 실패했습니다." });
    }
  }
);

// ──────────────────────────────────────────────
// 22. 프론트엔드 정적 파일 서빙 (React 빌드 결과물)
// ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// React Router 처리 — /api 외 모든 경로를 index.html로
app.get(/^(?!\/api).*$/, (_req: Request, res: Response) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ──────────────────────────────────────────────
// 23. 서버 시작
// ──────────────────────────────────────────────
ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    });
  })
  .catch((err) => {
    console.error("스키마 초기화 실패:", err);
    process.exit(1);
  });

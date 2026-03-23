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
  "F":  0,
};

/**
 * 등급 문자열을 점수(number)로 변환.
 * - 유효한 등급 → 해당 점수 반환 (F → 0 포함)
 * - undefined / null / 빈 문자열 → null (미입력)
 * - 알 수 없는 등급 문자열 → null (안전 처리)
 */
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

function normalizeWorks(
  raw: unknown
): Array<{ title: string; description: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w) => w && typeof w === "object")
    .map((w: any) => ({
      title: String(w.title ?? "").trim(),
      description: String(w.description ?? "").trim(),
    }));
}

// ──────────────────────────────────────────────
// 5. 스키마 초기화 및 시드 (DDL 구문 분리)
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
      scores      JSONB NOT NULL DEFAULT '{}',
      comment     TEXT,
      is_final    BOOLEAN NOT NULL DEFAULT FALSE,
      total_score NUMERIC(6,2),
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
    "SELECT id FROM users WHERE username = $1",
    ["admin"]
  );
  if (adminExists.rows.length === 0) {
    const hashed = await hashPassword("admin1234");
    await db.query(
      "INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)",
      ["admin", hashed, "관리자", "admin"]
    );
  }

  // 기본 라운드 1
  const roundExists = await db.query(
    "SELECT id FROM rounds WHERE round_number = $1",
    [1]
  );
  if (roundExists.rows.length === 0) {
    await db.query(
      "INSERT INTO rounds (round_number, is_active, name) VALUES ($1, $2, $3)",
      [1, true, "1차 심사"]
    );
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
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    ) as AuthenticatedRequest["user"];
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
// ──────────────────────────────────────────────
app.post("/api/auth/login", async (req: Request, res: Response) => {
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
      "SELECT id, username, password, name, role FROM users WHERE username = $1",
      [username.trim()]
    );
    if (result.rows.length === 0) {
      res
        .status(401)
        .json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
      return;
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res
        .status(401)
        .json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
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
      });
  } catch {
    res.status(500).json({ error: "로그인 처리 중 오류가 발생했습니다." });
  }
});

app.post("/api/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie("token").json({ success: true });
});

app.get(
  "/api/health",
  authMiddleware,
  (req: AuthenticatedRequest, res: Response) => {
    res.json(req.user);
  }
);

// ──────────────────────────────────────────────
// 9. 관리자: 사용자 CRUD
// ──────────────────────────────────────────────
app.get(
  "/api/admin/users",
  authMiddleware,
  adminMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT id, username, name, role, department, student_id, created_at
         FROM users
         ORDER BY created_at ASC`
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
    if (!username || !password || !name || !role) {
      res
        .status(400)
        .json({ error: "필수 항목(username, password, name, role)을 입력하세요." });
      return;
    }
    try {
      const hashed = await hashPassword(password);
      const result = await db.query(
        `INSERT INTO users (username, password, name, role, department, student_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, name, role, department, student_id, created_at`,
        [
          username.trim(),
          hashed,
          name.trim(),
          role,
          department ?? null,
          student_id ?? null,
        ]
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
          `UPDATE users
           SET name=$1, role=$2, department=$3, student_id=$4, password=$5
           WHERE id=$6`,
          [name, role, department ?? null, student_id ?? null, hashed, id]
        );
      } else {
        await db.query(
          `UPDATE users
           SET name=$1, role=$2, department=$3, student_id=$4
           WHERE id=$5`,
          [name, role, department ?? null, student_id ?? null, id]
        );
      }
      const updated = await db.query(
        `SELECT id, username, name, role, department, student_id, created_at
         FROM users WHERE id = $1`,
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

// 대량 사용자 생성 (트랜잭션)
app.post(
  "/api/admin/users/bulk",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const users = req.body as Array<{
      username: string;
      password: string;
      name: string;
      role: string;
      department?: string;
      student_id?: string;
    }>;
    if (!Array.isArray(users) || users.length === 0) {
      res.status(400).json({ error: "사용자 배열이 필요합니다." });
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const created: unknown[] = [];
      for (const u of users) {
        if (!u.username || !u.password || !u.name || !u.role) continue;
        const hashed = await hashPassword(u.password);
        const result = await client.query(
          `INSERT INTO users (username, password, name, role, department, student_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (username) DO NOTHING
           RETURNING id, username, name, role, department, student_id`,
          [
            u.username.trim(),
            hashed,
            u.name.trim(),
            u.role,
            u.department ?? null,
            u.student_id ?? null,
          ]
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
// 10. 관리자: 라운드 CRUD
// ──────────────────────────────────────────────
app.get(
  "/api/admin/rounds",
  authMiddleware,
  adminMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT * FROM rounds ORDER BY round_number ASC"
      );
      res.json(result.rows);
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
      round_number?: number;
      name?: string;
      is_active?: boolean;
    };
    if (round_number === undefined) {
      res.status(400).json({ error: "round_number가 필요합니다." });
      return;
    }
    try {
      const result = await db.query(
        `INSERT INTO rounds (round_number, name, is_active)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [
          round_number,
          name ?? `${round_number}차 심사`,
          normalizeBoolean(is_active),
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "이미 존재하는 라운드 번호입니다." });
      } else {
        res.status(500).json({ error: "라운드 생성에 실패했습니다." });
      }
    }
  }
);

app.patch(
  "/api/admin/rounds/:id/toggle",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const current = await db.query(
        "SELECT id, is_active FROM rounds WHERE id = $1",
        [id]
      );
      if (current.rows.length === 0) {
        res.status(404).json({ error: "라운드를 찾을 수 없습니다." });
        return;
      }
      const updated = await db.query(
        "UPDATE rounds SET is_active = $1 WHERE id = $2 RETURNING *",
        [!current.rows[0].is_active, id]
      );
      res.json(updated.rows[0]);
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
// 11. 관리자: 통계 (N+1 해소 – JOIN + ANY)
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
      // 1) 해당 라운드의 모든 기획안 조회
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
      if (proposals.length === 0) {
        res.json([]);
        return;
      }

      const proposalIds = proposals.map((p) => p.id);

      // 2) 모든 평가를 한 번에 조회 (N+1 제거)
      const evaluationsResult = await db.query(
        `SELECT e.proposal_id, e.judge_id, e.scores, e.total_score, e.is_final,
                u.name AS judge_name
         FROM evaluations e
         JOIN users u ON u.id = e.judge_id
         WHERE e.proposal_id = ANY($1::uuid[])`,
        [proposalIds]
      );

      // 3) proposal_id 기준 Map 구성
      const evalMap = new Map<string, typeof evaluationsResult.rows>();
      for (const e of evaluationsResult.rows) {
        if (!evalMap.has(e.proposal_id)) evalMap.set(e.proposal_id, []);
        evalMap.get(e.proposal_id)!.push(e);
      }

      // 4) 통계 조합
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
            totalScore:
              e.total_score != null ? parseFloat(e.total_score) : null,
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
// 12. 관리자: 데이터 초기화 (트랜잭션)
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
// 13. 관리자: 시드 데이터 생성 (트랜잭션)
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
          [
            student.id,
            roundNumber,
            `${student.name}의 기획안`,
            "시드 데이터로 생성된 기획안입니다.",
          ]
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
// 14. 관리자: 백업 (Excel)
// ──────────────────────────────────────────────
app.get(
  "/api/admin/backup",
  authMiddleware,
  adminMiddleware,
  async (_req: Request, res: Response) => {
    try {
      const [usersRes, roundsRes, proposalsRes, evalsRes] = await Promise.all([
        db.query(
          "SELECT id, username, name, role, department, student_id, created_at FROM users"
        ),
        db.query("SELECT * FROM rounds ORDER BY round_number"),
        db.query(`
          SELECT p.*, u.name AS student_name, u.student_id AS student_no
          FROM proposals p
          JOIN users u ON u.id = p.student_id
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
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(usersRes.rows),
        "Users"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(roundsRes.rows),
        "Rounds"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(proposalsRes.rows),
        "Proposals"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(evalsRes.rows),
        "Evaluations"
      );

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const filename = `backup_${new Date().toISOString().slice(0, 10)}.xlsx`;

      res
        .setHeader("Content-Disposition", `attachment; filename="${filename}"`)
        .setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        .send(buffer);
    } catch {
      res.status(500).json({ error: "백업 생성에 실패했습니다." });
    }
  }
);

// ──────────────────────────────────────────────
// 15. 기획안 라우트
// ──────────────────────────────────────────────
app.get(
  "/api/proposals/:roundNumber",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const roundNumber = parseInt(req.params.roundNumber, 10);
    const user = req.user!;
    try {
      let result;
      if (user.role === "student") {
        result = await db.query(
          `SELECT p.*, u.name AS student_name
           FROM proposals p
           JOIN users u ON u.id = p.student_id
           WHERE p.round_number = $1 AND p.student_id = $2`,
          [roundNumber, user.id]
        );
      } else {
        result = await db.query(
          `SELECT p.*, u.name AS student_name, u.student_id AS student_no
           FROM proposals p
           JOIN users u ON u.id = p.student_id
           WHERE p.round_number = $1
           ORDER BY u.name ASC`,
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
    const {
      round_number,
      title,
      content,
      works: rawWorks,
    } = req.body as {
      round_number?: number;
      title?: string;
      content?: string;
      works?: unknown;
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
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
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
    const {
      title,
      content,
      works: rawWorks,
    } = req.body as {
      title?: string;
      content?: string;
      works?: unknown;
    };
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT id, student_id, is_final, title FROM proposals WHERE id = $1",
        [id]
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
        res
          .status(403)
          .json({ error: "최종 제출된 기획안은 수정할 수 없습니다." });
        return;
      }

      await client.query(
        "UPDATE proposals SET title = $1, content = $2, updated_at = NOW() WHERE id = $3",
        [title ?? proposal.title, content ?? null, id]
      );

	      const worksData = normalizeWorks(rawWorks);
      if (worksData.length > 0) {
        const existingWorks = await client.query(
          "SELECT id FROM works WHERE proposal_id = $1",
          [id]
        );
        const workIds = existingWorks.rows.map((w: any) => w.id);
        if (workIds.length > 0) {
          await client.query(
            "DELETE FROM work_images WHERE work_id = ANY($1::uuid[])",
            [workIds]
          );
        }
        await client.query("DELETE FROM works WHERE proposal_id = $1", [id]); // ← 들여쓰기 수정
        for (const w of worksData) {
          await client.query(
            "INSERT INTO works (proposal_id, title, description) VALUES ($1, $2, $3)",
            [id, w.title, w.description]
          );
        }
      }

      const updated = await client.query(
        "SELECT * FROM proposals WHERE id = $1",
        [id]
      );
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
// 16. 이미지 업로드
// ──────────────────────────────────────────────
app.post(
  "/api/works/:workId/images",

  authMiddleware,
  upload.single("image"),
  async (req: AuthenticatedRequest, res: Response) => {
    const { workId } = req.params;
    if (!req.file) {
      res.status(400).json({ error: "이미지 파일이 필요합니다." });
      return;
    }
    try {
      const ext = req.file.originalname.split(".").pop() ?? "jpg";
      const filename = `${workId}/${Date.now()}.${ext}`;
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
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filename);

      const result = await db.query(
        "INSERT INTO work_images (work_id, url) VALUES ($1, $2) RETURNING *",
        [workId, urlData.publicUrl]
      );
      res.status(201).json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "이미지 처리 중 오류가 발생했습니다." });
    }
  }
);

// ──────────────────────────────────────────────
// 17. 평가 라우트 (트랜잭션)
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
           FROM evaluations e
           JOIN users u ON u.id = e.judge_id
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
    const { proposal_id, scores, comment, is_final } = req.body as {
      proposal_id?: string;
      scores?: Record<string, string>;
      comment?: string;
      is_final?: boolean;
    };
    if (!proposal_id || !scores) {
      res.status(400).json({ error: "proposal_id와 scores가 필요합니다." });
      return;
    }

    // 점수 계산: null이 아닌 항목만 평균 (F=0 포함)
    const scoreValues = Object.values(scores)
      .map((g) => scoreOrNull(g))
      .filter((v): v is number => v !== null);
    const totalScore =
      scoreValues.length > 0 ? roundTwo(average(scoreValues)) : null;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT id, is_final FROM evaluations WHERE proposal_id = $1 AND judge_id = $2",
        [proposal_id, user.id]
      );

      let result;
      if (existing.rows.length > 0) {
        if (existing.rows[0].is_final && user.role !== "admin") {
          await client.query("ROLLBACK");
          res
            .status(403)
            .json({ error: "최종 제출된 평가는 수정할 수 없습니다." });
          return;
        }
        // is_final은 명시적으로 전달된 경우에만 업데이트
        if (is_final !== undefined) {
          result = await client.query(
            `UPDATE evaluations
             SET scores=$1, comment=$2, total_score=$3, is_final=$4, updated_at=NOW()
             WHERE proposal_id=$5 AND judge_id=$6
             RETURNING *`,
            [scores, comment ?? null, totalScore, is_final, proposal_id, user.id]
          );
        } else {
          result = await client.query(
            `UPDATE evaluations
             SET scores=$1, comment=$2, total_score=$3, updated_at=NOW()
             WHERE proposal_id=$4 AND judge_id=$5
             RETURNING *`,
            [scores, comment ?? null, totalScore, proposal_id, user.id]
          );
        }
      } else {
        result = await client.query(
          `INSERT INTO evaluations
             (proposal_id, judge_id, scores, comment, total_score, is_final)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            proposal_id,
            user.id,
            scores,
            comment ?? null,
            totalScore,
            is_final ?? false,
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

// 평가 삭제 (본인)
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
        res
          .status(403)
          .json({ error: "최종 제출된 평가는 삭제할 수 없습니다." });
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

// 평가 삭제 (관리자 전용 – 특정 심사위원 지정)
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
        res
          .status(403)
          .json({ error: "최종 제출된 평가는 삭제할 수 없습니다." });
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
// 18. 관리자: 제출안 초기화 (트랜잭션)
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
        "SELECT id FROM proposals WHERE id = $1",
        [proposalId]
      );
      if (proposalResult.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "기획안을 찾을 수 없습니다." });
        return;
      }

      const worksResult = await client.query(
        "SELECT id FROM works WHERE proposal_id = $1",
        [proposalId]
      );
      const workIds = worksResult.rows.map((w: any) => w.id);

      if (workIds.length > 0) {
        const urlResult = await client.query(
          "SELECT url FROM work_images WHERE work_id = ANY($1::uuid[])",
          [workIds]
        );
        const paths = urlResult.rows.map((r: any) =>
          r.url.split("/").slice(-2).join("/")
        );
        if (paths.length > 0) {
          await supabase.storage.from(STORAGE_BUCKET).remove(paths);
        }
        await client.query(
          "DELETE FROM work_images WHERE work_id = ANY($1::uuid[])",
          [workIds]
        );
      }

      await client.query(
        "DELETE FROM evaluations WHERE proposal_id = $1",
        [proposalId]
      );
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
// 19. 발표 순서 관리
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
    const { round_number, orders } = req.body as {
      round_number?: number;
      orders?: Array<{ proposal_id: string; order_index: number }>;
    };
    if (!round_number || !Array.isArray(orders)) {
      res
        .status(400)
        .json({ error: "round_number와 orders 배열이 필요합니다." });
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM presentation_orders WHERE round_number = $1",
        [round_number]
      );
      for (const o of orders) {
        await client.query(
          `INSERT INTO presentation_orders (round_number, proposal_id, order_index)
           VALUES ($1, $2, $3)`,
          [round_number, o.proposal_id, o.order_index]
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
// 20. 심사위원: 학생 목록 조회 (라운드 기준)
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
// 21. 서버 시작
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

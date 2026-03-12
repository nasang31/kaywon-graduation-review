import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import pg from "pg";
import path from "path";
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
        name: string;
      };
    }
  }
}

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "test123";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const query = async (sql: string, params: any[] = []) => {
  const result = await pool.query(sql, params);
  return result.rows;
};

const getOne = async (sql: string, params: any[] = []) => {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
};

const run = async (sql: string, params: any[] = []) => {
  return pool.query(sql, params);
};

app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

const authenticate = (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch {
    res.clearCookie("token");
    return res.status(401).json({ error: "인증이 만료되었습니다." });
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

const numberToGrade = (score: number) => {
  if (score >= 97) return "A+";
  if (score >= 93) return "A0";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B0";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C0";
  if (score >= 70) return "C-";
  if (score >= 67) return "D+";
  if (score >= 63) return "D0";
  return "F";
};

const legacyEvaluationShape = (row: any) => {
  const grade = numberToGrade(Number(row.score || 0));
  return {
    ...row,
    judge_name: row.judge_name,
    text_grade: grade,
    work1_grade: grade,
    work2_grade: grade,
    work3_grade: grade,
  };
};

const ensureTables = async () => {
  await run(`
    create extension if not exists pgcrypto;

    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      name text not null,
      email text not null unique,
      role text not null,
      password text not null
    );

    create table if not exists projects (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      title text not null,
      description text,
      file_url text,
      status text default 'submitted',
      student_id uuid references users(id) on delete cascade
    );

    create table if not exists evaluations (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      project_id uuid references projects(id) on delete cascade,
      judge_id uuid references users(id) on delete cascade,
      score int,
      comment text
    );
  `);
};

// --------------------
// Health check
// --------------------
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true, message: "server ok" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --------------------
// Auth
// --------------------
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await getOne(
      `
      select id, username, name, role, password
      from users
      where username = $1
      `,
      [username]
    );

    if (!user) {
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    if (user.password !== password) {
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

app.get("/api/me", authenticate, async (req, res) => {
  res.json(req.user);
});

// --------------------
// Users
// --------------------
app.get("/api/users", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const users = await query(
      `
      select id, created_at, username, name, role
      from users
      order by created_at desc
      `
    );
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/users", authenticate, authorize(["admin"]), async (_req, res) => {
  try {
    const users = await query(
      `
      select id,
             email as username,
             name,
             role,
             email as student_id,
             0 as needs_password_change
      from users
      where role <> 'admin'
      order by created_at desc
      `
    );
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { username, name, role, password } = req.body;

    const existing = await getOne(
      `select id from users where username = $1`,
      [username]
    );

    if (existing) {
      return res.status(400).json({ error: "이미 존재하는 아이디입니다." });
    }

    const inserted = await getOne(
      `
      insert into users (username, name, role, password)
      values ($1, $2, $3, $4)
      returning id, created_at, username, name, role
      `,
      [username, name, role, password]
    );

    res.json(inserted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    const { username, name, role, password } = req.body;
    const email = username;
    const existing = await getOne(`select id from users where email = $1`, [email]);

    if (existing) {
      return res.status(400).json({ error: "이미 존재하는 이메일입니다." });
    }

    const inserted = await getOne(
      `
      insert into users (name, email, role, password)
      values ($1, $2, $3, $4)
      returning id, created_at, name, email, role
      `,
      [name, email, role, password || username || "1234"]
    );

    res.json({ success: true, user: inserted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// Projects
// --------------------
app.get("/api/projects", authenticate, async (req: any, res) => {
  try {
    if (req.user.role === "admin" || req.user.role === "judge") {
      const projects = await query(
        `
        select
          p.id,
          p.created_at,
          p.title,
          p.description,
          p.file_url,
          p.status,
          p.student_id,
          u.name as student_name,
          u.email as student_email
        from projects p
        left join users u on u.id = p.student_id
        order by p.created_at desc
        `
      );
      return res.json(projects);
    }

    const projects = await query(
      `
      select
        p.id,
        p.created_at,
        p.title,
        p.description,
        p.file_url,
        p.status,
        p.student_id
      from projects p
      where p.student_id = $1
      order by p.created_at desc
      `,
      [req.user.id]
    );

    res.json(projects);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:id", authenticate, async (req: any, res) => {
  try {
    const project = await getOne(
      `
      select
        p.id,
        p.created_at,
        p.title,
        p.description,
        p.file_url,
        p.status,
        p.student_id,
        u.name as student_name,
        u.email as student_email
      from projects p
      left join users u on u.id = p.student_id
      where p.id = $1
      `,
      [req.params.id]
    );

    if (!project) {
      return res.status(404).json({ error: "작품을 찾을 수 없습니다." });
    }

    if (req.user.role === "student" && project.student_id !== req.user.id) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    const evaluations = await query(
      `
      select
        e.id,
        e.created_at,
        e.project_id,
        e.judge_id,
        e.score,
        e.comment,
        u.name as judge_name,
        u.email as judge_email
      from evaluations e
      left join users u on u.id = e.judge_id
      where e.project_id = $1
      order by e.created_at desc
      `,
      [req.params.id]
    );

    res.json({ ...project, evaluations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects", authenticate, authorize(["student", "admin"]), async (req: any, res) => {
  try {
    const { title, description, file_url, status, student_id } = req.body;
    const targetStudentId = req.user.role === "student" ? req.user.id : student_id;

    const inserted = await getOne(
      `
      insert into projects (title, description, file_url, status, student_id)
      values ($1, $2, $3, $4, $5)
      returning *
      `,
      [title, description || "", file_url || "", status || "submitted", targetStudentId]
    );

    res.json(inserted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/projects/:id", authenticate, authorize(["student", "admin"]), async (req: any, res) => {
  try {
    const project = await getOne(`select * from projects where id = $1`, [req.params.id]);

    if (!project) {
      return res.status(404).json({ error: "작품을 찾을 수 없습니다." });
    }

    if (req.user.role === "student" && project.student_id !== req.user.id) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    const { title, description, file_url, status } = req.body;

    const updated = await getOne(
      `
      update projects
      set title = $1,
          description = $2,
          file_url = $3,
          status = $4
      where id = $5
      returning *
      `,
      [
        title ?? project.title,
        description ?? project.description,
        file_url ?? project.file_url,
        status ?? project.status,
        req.params.id,
      ]
    );

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id", authenticate, authorize(["student", "admin"]), async (req: any, res) => {
  try {
    const project = await getOne(`select * from projects where id = $1`, [req.params.id]);

    if (!project) {
      return res.status(404).json({ error: "작품을 찾을 수 없습니다." });
    }

    if (req.user.role === "student" && project.student_id !== req.user.id) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    await run(`delete from evaluations where project_id = $1`, [req.params.id]);
    await run(`delete from projects where id = $1`, [req.params.id]);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// Legacy compatibility for existing frontend
// --------------------
app.get("/api/admin/rounds", authenticate, authorize(["admin"]), async (_req, res) => {
  res.json([
    { round_number: 1, is_open: 1, name: "졸업작품 기획 1차 심사" },
    { round_number: 2, is_open: 0, name: "졸업작품 기획 2차 심사" },
    { round_number: 3, is_open: 0, name: "졸업작품 기획 3차 심사" },
  ]);
});

app.post("/api/admin/rounds/toggle", authenticate, authorize(["admin"]), async (_req, res) => {
  res.json({ success: true });
});

app.get("/api/students/:roundNumber", authenticate, authorize(["judge", "admin"]), async (req: any, res) => {
  try {
    const judgeId = req.query.judgeId || req.user.id;
    const students = await query(
      `
      select
        p.id,
        p.title,
        p.status,
        p.student_id as user_id,
        u.name as student_name,
        1 as is_participating,
        row_number() over (order by p.created_at asc) as presentation_order,
        coalesce((select count(*) from evaluations e where e.project_id = p.id), 0) as total_eval_count,
        coalesce((select count(*) from evaluations e where e.project_id = p.id and e.judge_id = $1), 0) as my_eval_count,
        number_to_grade(coalesce((select avg(score) from evaluations e where e.project_id = p.id and e.judge_id = $1), 0)) as my_text_grade,
        number_to_grade(coalesce((select avg(score) from evaluations e where e.project_id = p.id and e.judge_id = $1), 0)) as my_work1_grade,
        number_to_grade(coalesce((select avg(score) from evaluations e where e.project_id = p.id and e.judge_id = $1), 0)) as my_work2_grade,
        number_to_grade(coalesce((select avg(score) from evaluations e where e.project_id = p.id and e.judge_id = $1), 0)) as my_work3_grade
      from projects p
      join users u on u.id = p.student_id
      order by p.created_at asc
      `,
      [judgeId]
    );
    res.json(students);
  } catch (_err: any) {
    // fallback without SQL function
    const rows = await query(
      `
      select
        p.id,
        p.title,
        p.status,
        p.student_id as user_id,
        u.name as student_name,
        p.created_at
      from projects p
      join users u on u.id = p.student_id
      order by p.created_at asc
      `
    );

    const mapped = [];
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      const myRows = await query(`select score from evaluations where project_id = $1 and judge_id = $2`, [p.id, judgeId]);
      const myAvg = myRows.length ? myRows.reduce((a: number, b: any) => a + Number(b.score), 0) / myRows.length : 0;
      const total = await getOne(`select count(*)::int as count from evaluations where project_id = $1`, [p.id]);
      mapped.push({
        ...p,
        is_participating: 1,
        presentation_order: i + 1,
        total_eval_count: total?.count || 0,
        my_eval_count: myRows.length,
        my_text_grade: numberToGrade(myAvg),
        my_work1_grade: numberToGrade(myAvg),
        my_work2_grade: numberToGrade(myAvg),
        my_work3_grade: numberToGrade(myAvg),
      });
    }
    res.json(mapped);
  }
});

app.get("/api/proposals/:id", authenticate, async (req: any, res) => {
  try {
    const project = await getOne(
      `
      select p.*, u.name as student_name, u.email as student_id
      from projects p
      left join users u on u.id = p.student_id
      where p.id = $1
      `,
      [req.params.id]
    );

    if (!project) {
      return res.status(404).json({ error: "Not found" });
    }

    const evaluations = await query(
      `
      select e.*, u.name as judge_name
      from evaluations e
      left join users u on u.id = e.judge_id
      where e.project_id = $1
      order by e.created_at desc
      `,
      [req.params.id]
    );

    res.json({
      id: project.id,
      user_id: project.student_id,
      student_id: project.student_id,
      name: project.student_name,
      career_path: "공간연출",
      careerPath: "공간연출",
      title: project.title,
      author: project.student_name,
      genre: "공간연출",
      plot: project.description,
      subject: project.description,
      reason: project.description,
      is_submitted: 1,
      works: [
        {
          id: project.id,
          workNumber: 1,
          title: project.title,
          category: "공간연출",
          summary: project.description,
          keywords: "졸업작품",
          purpose: "졸업작품",
          effect: "졸업작품",
          images: project.file_url ? [project.file_url] : [],
        },
      ],
      evaluations: evaluations.map(legacyEvaluationShape),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/proposals/my/:userId/:roundNumber", authenticate, async (req: any, res) => {
  try {
    const project = await getOne(
      `
      select * from projects
      where student_id = $1
      order by created_at desc
      limit 1
      `,
      [req.params.userId]
    );

    if (!project) {
      return res.json(null);
    }

    const evalCount = await getOne(`select count(*)::int as count from evaluations where project_id = $1`, [project.id]);

    res.json({
      id: project.id,
      user_id: project.student_id,
      round_number: Number(req.params.roundNumber),
      student_id: project.student_id,
      name: req.user?.name || "학생",
      careerPath: "공간연출",
      title: project.title,
      author: req.user?.name || "학생",
      genre: "공간연출",
      plot: project.description,
      subject: project.description,
      reason: project.description,
      is_submitted: 1,
      is_evaluated: Number(evalCount?.count || 0) > 0,
      works: [
        {
          id: project.id,
          workNumber: 1,
          title: project.title,
          category: "공간연출",
          summary: project.description,
          keywords: "졸업작품",
          purpose: "졸업작품",
          effect: "졸업작품",
          images: project.file_url ? [project.file_url] : [],
        },
      ],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/proposals", authenticate, authorize(["student", "admin"]), async (req: any, res) => {
  try {
    const { userId, title, plot, subject, reason, works } = req.body;
    const targetStudentId = req.user.role === "student" ? req.user.id : userId;

    const firstWork = Array.isArray(works) && works[0] ? works[0] : null;
    const fileUrl = firstWork?.images?.[0] || "";
    const description = plot || subject || reason || firstWork?.summary || "";

    const inserted = await getOne(
      `
      insert into projects (title, description, file_url, status, student_id)
      values ($1, $2, $3, $4, $5)
      returning *
      `,
      [title, description, fileUrl, "submitted", targetStudentId]
    );

    res.json({ success: true, id: inserted.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// Evaluations
// --------------------
app.get("/api/evaluations/project/:projectId", authenticate, async (req: any, res) => {
  try {
    const project = await getOne(`select * from projects where id = $1`, [req.params.projectId]);

    if (!project) {
      return res.status(404).json({ error: "작품을 찾을 수 없습니다." });
    }

    if (req.user.role === "student" && project.student_id !== req.user.id) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    const rows = await query(
      `
      select
        e.id,
        e.created_at,
        e.project_id,
        e.judge_id,
        e.score,
        e.comment,
        u.name as judge_name,
        u.email as judge_email
      from evaluations e
      left join users u on u.id = e.judge_id
      where e.project_id = $1
      order by e.created_at desc
      `,
      [req.params.projectId]
    );

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/evaluations", authenticate, authorize(["judge", "admin"]), async (req: any, res) => {
  try {
    const { project_id, proposalId, score, comment, text_grade, work1_grade, work2_grade, work3_grade } = req.body;
    const finalProjectId = project_id || proposalId;

    const project = await getOne(`select * from projects where id = $1`, [finalProjectId]);
    if (!project) {
      return res.status(404).json({ error: "작품을 찾을 수 없습니다." });
    }

    let finalScore = score;
    if (finalScore == null) {
      const grades = [text_grade, work1_grade, work2_grade, work3_grade].filter(Boolean);
      if (grades.length > 0) {
        const total = grades.reduce((acc: number, g: string) => acc + (gradeMap[g] || 0), 0);
        finalScore = Math.round(total / grades.length);
      } else {
        finalScore = 0;
      }
    }

    const existing = await getOne(
      `select * from evaluations where project_id = $1 and judge_id = $2`,
      [finalProjectId, req.user.id]
    );

    if (existing) {
      const updated = await getOne(
        `
        update evaluations
        set score = $1,
            comment = $2
        where id = $3
        returning *
        `,
        [finalScore, comment || "", existing.id]
      );
      return res.json({ success: true, evaluation: updated });
    }

    const inserted = await getOne(
      `
      insert into evaluations (project_id, judge_id, score, comment)
      values ($1, $2, $3, $4)
      returning *
      `,
      [finalProjectId, req.user.id, finalScore, comment || ""]
    );

    res.json({ success: true, evaluation: inserted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/evaluations/:id", authenticate, authorize(["judge", "admin"]), async (req: any, res) => {
  try {
    const evaluation = await getOne(`select * from evaluations where id = $1`, [req.params.id]);

    if (!evaluation) {
      return res.status(404).json({ error: "평가를 찾을 수 없습니다." });
    }

    if (req.user.role === "judge" && evaluation.judge_id !== req.user.id) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    const { score, comment } = req.body;

    const updated = await getOne(
      `
      update evaluations
      set score = $1,
          comment = $2
      where id = $3
      returning *
      `,
      [score ?? evaluation.score, comment ?? evaluation.comment, req.params.id]
    );

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/evaluations/:id", authenticate, authorize(["judge", "admin"]), async (req: any, res) => {
  try {
    const evaluation = await getOne(`select * from evaluations where id = $1`, [req.params.id]);

    if (!evaluation) {
      return res.status(404).json({ error: "평가를 찾을 수 없습니다." });
    }

    if (req.user.role === "judge" && evaluation.judge_id !== req.user.id) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    await run(`delete from evaluations where id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/evaluations/:proposalId/:judgeId", authenticate, authorize(["judge", "admin"]), async (req: any, res) => {
  try {
    if (req.user.role === "judge" && req.user.id !== req.params.judgeId) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    await run(`delete from evaluations where project_id = $1 and judge_id = $2`, [req.params.proposalId, req.params.judgeId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// Admin stats and tools
// --------------------
app.get("/api/admin/stats", authenticate, authorize(["admin"]), async (_req, res) => {
  try {
    const stats = await query(
      `
      select
        p.id as project_id,
        p.title,
        p.status,
        u.name as student_name,
        u.email as student_email,
        count(e.id)::int as evaluation_count,
        coalesce(avg(e.score), 0)::float as average_score
      from projects p
      left join users u on u.id = p.student_id
      left join evaluations e on e.project_id = p.id
      group by p.id, p.title, p.status, u.name, u.email, p.created_at
      order by p.created_at desc
      `
    );

    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/stats/:roundNumber", authenticate, authorize(["admin"]), async (_req, res) => {
  try {
    const students = await query(
      `
      select id as user_id, email as student_id, name
      from users
      where role = 'student'
      order by created_at asc
      `
    );

    const rows = [] as any[];

    for (const s of students) {
      const project = await getOne(
        `
        select *
        from projects
        where student_id = $1
        order by created_at desc
        limit 1
        `,
        [s.user_id]
      );

      if (!project) {
        rows.push({
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

      const evals = await query(
        `
        select e.*, u.name as judge_name
        from evaluations e
        left join users u on u.id = e.judge_id
        where e.project_id = $1
        order by e.created_at asc
        `,
        [project.id]
      );

      const processed = evals.map((e: any) => {
        const grade = numberToGrade(Number(e.score || 0));
        const numeric = gradeMap[grade] || 0;
        return {
          ...e,
          judge_name: e.judge_name,
          text_grade: grade,
          work1_grade: grade,
          work2_grade: grade,
          work3_grade: grade,
          scores: {
            text: numeric,
            work1: numeric,
            work2: numeric,
            work3: numeric,
          },
          totalScore: numeric,
        };
      });

      const avg = processed.length
        ? processed.reduce((acc: number, e: any) => acc + e.totalScore, 0) / processed.length
        : 0;

      rows.push({
        id: project.id,
        user_id: s.user_id,
        student_id: s.student_id,
        name: s.name,
        title: project.title,
        is_submitted: 1,
        is_participating: 1,
        presentation_order: 1,
        evaluations: processed,
        averageScore: avg.toFixed(2),
        avgText: avg.toFixed(2),
        avgWork1: avg.toFixed(2),
        avgWork2: avg.toFixed(2),
        avgWork3: avg.toFixed(2),
      });
    }

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/clear-data", authenticate, authorize(["admin"]), async (_req, res) => {
  try {
    await run(`delete from evaluations`);
    await run(`delete from projects`);
    await run(`delete from users where role <> 'admin'`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/backup", authenticate, authorize(["admin"]), async (_req, res) => {
  try {
    const projects = await query(`select * from projects order by created_at desc`);
    const evaluations = await query(`select * from evaluations order by created_at desc`);
    const users = await query(`select id, email as username, role, name, email as student_id from users order by created_at desc`);
    res.json({ proposals: projects, evaluations, users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/seed", authenticate, authorize(["admin"]), async (req, res) => {
  try {
    // 1. 기존 테스트 데이터 정리
    await query(`delete from evaluations`);
    await query(`delete from projects`);
    await query(`delete from users where role <> 'admin'`);

    // 2. 심사위원 생성
    const judgesData = [
      { username: "judge01", name: "김교수", role: "judge", password: "judge01" },
      { username: "judge02", name: "이교수", role: "judge", password: "judge02" },
      { username: "judge03", name: "박교수", role: "judge", password: "judge03" },
      { username: "judge04", name: "최교수", role: "judge", password: "judge04" },
      { username: "judge05", name: "정교수", role: "judge", password: "judge05" },
    ];

    const judges: any[] = [];

    for (const j of judgesData) {
      const judge = await getOne(
        `
        insert into users (username, name, role, password)
        values ($1, $2, $3, $4)
        returning id, username, name, role
        `,
        [j.username, j.name, j.role, j.password]
      );
      judges.push(judge);
    }

    // 3. 학생 + 작품 생성
    const studentsData = [
      { username: "20240001", name: "홍길동", role: "student", password: "20240001" },
      { username: "20240002", name: "김철수", role: "student", password: "20240002" },
      { username: "20240003", name: "이영희", role: "student", password: "20240003" },
      { username: "20240004", name: "박민수", role: "student", password: "20240004" },
      { username: "20240005", name: "최수진", role: "student", password: "20240005" },
      { username: "20240006", name: "오세훈", role: "student", password: "20240006" },
      { username: "20240007", name: "한지민", role: "student", password: "20240007" },
      { username: "20240008", name: "강서연", role: "student", password: "20240008" },
      { username: "20240009", name: "윤도현", role: "student", password: "20240009" },
      { username: "20240010", name: "정민아", role: "student", password: "20240010" }
    ];

    const projects: any[] = [];

    for (let i = 0; i < studentsData.length; i++) {
      const s = studentsData[i];

      const student = await getOne(
        `
        insert into users (username, name, role, password)
        values ($1, $2, $3, $4)
        returning id, username, name, role
        `,
        [s.username, s.name, s.role, s.password]
      );

      const project = await getOne(
        `
        insert into projects (title, description, file_url, status, student_id)
        values ($1, $2, $3, $4, $5)
        returning *
        `,
        [
          `졸업작품 ${i + 1}`,
          `${s.name}의 공간연출 졸업작품 테스트 데이터`,
          `test-${i + 1}.pdf`,
          "submitted",
          student.id,
        ]
      );

      projects.push(project);
    }

    // 4. 평가 생성
    for (const project of projects) {
      for (const judge of judges) {
        const randomScore = Math.floor(Math.random() * 21) + 80; // 80~100

        await getOne(
          `
          insert into evaluations (project_id, judge_id, score, comment)
          values ($1, $2, $3, $4)
          returning *
          `,
          [
            project.id,
            judge.id,
            randomScore,
            `${judge.name} 평가: 공간 구성과 아이디어가 좋습니다.`,
          ]
        );
      }
    }

    res.json({ success: true, message: "테스트 데이터 생성 완료" });
  } catch (err: any) {
    console.error("[SEED ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/presentation-order", authenticate, authorize(["admin"]), async (_req, res) => {
  res.json({ success: true });
});

// --------------------
// Vite SPA
// --------------------
async function startServer() {
  try {
    await pool.query("select 1");
    await ensureTables();
    console.log("PostgreSQL connected");
  } catch (err) {
    console.error("DB connection failed:", err);
    process.exit(1);
  }

  if (process.env.NODE_ENV !== "production") {
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
    res.status(500).json({ error: err.message || "서버 오류" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

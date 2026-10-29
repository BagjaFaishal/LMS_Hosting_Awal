import "dotenv/config";
import http from "node:http";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { PrismaClient, MaterialType } from "@prisma/client";
import { z } from "zod";

const required = ["DATABASE_URL", "ADMIN_USERNAME", "ADMIN_PASSWORD", "JWT_SECRET"] as const;
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
if ((process.env.JWT_SECRET?.length ?? 0) < 32) throw new Error("JWT_SECRET must be at least 32 characters.");

const prisma = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });
const app = express();
const server = http.createServer(app);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const io = new Server(server, {
  cors: { origin: webOrigin, credentials: true },
  transports: ["websocket", "polling"],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  connectionStateRecovery: { maxDisconnectionDuration: 60_000, skipMiddlewares: false },
});

// Redis enables Socket.io broadcasts across API replicas. Without it, one process supports the local/single-node setup.
if (process.env.REDIS_URL) {
  const { createClient } = require("redis");
  const { createAdapter } = require("@socket.io/redis-adapter");
  const pub = createClient({ url: process.env.REDIS_URL });
  const sub = pub.duplicate();
  Promise.all([pub.connect(), sub.connect()]).then(() => io.adapter(createAdapter(pub, sub))).catch((error: unknown) => {
    console.error("Redis Socket.io adapter failed to connect", error);
    process.exit(1);
  });
}

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: webOrigin, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use("/api", rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));

const JWT_SECRET = process.env.JWT_SECRET!;
const COOKIE = "paud_teacher";
type TeacherRequest = Request & { teacher?: boolean };
function teacherOnly(req: TeacherRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  try {
    const claims = jwt.verify(token, JWT_SECRET) as { role?: string };
    if (claims.role !== "teacher") throw new Error("role");
    req.teacher = true;
    next();
  } catch {
    res.status(401).json({ error: "Silakan masuk kembali." });
  }
}

const loginSchema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });
app.post("/api/admin/login", rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const input = loginSchema.safeParse(req.body);
  if (!input.success || input.data.username !== process.env.ADMIN_USERNAME || input.data.password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: "Nama pengguna atau kata sandi belum cocok." }); return;
  }
  const token = jwt.sign({ role: "teacher" }, JWT_SECRET, { expiresIn: "12h" });
  res.cookie(COOKIE, token, { httpOnly: true, secure: process.env.COOKIE_SECURE === "true", sameSite: "lax", maxAge: 12 * 60 * 60 * 1000, path: "/" }).json({ ok: true });
});
app.post("/api/admin/logout", (_req, res) => { res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", path: "/" }).json({ ok: true }); });
app.get("/api/admin/me", teacherOnly, (_req, res) => res.json({ authenticated: true }));
app.get("/api/admin/overview", teacherOnly, async (_req, res, next) => {
  try {
    const [online, scores, materials, reflection] = await Promise.all([
      prisma.studentSession.findMany({ where: { online: true, endedAt: null, expiresAt: { gt: new Date() } }, include: { student: true }, orderBy: { startedAt: "desc" } }),
      prisma.quizAttempt.findMany({ include: { student: true }, orderBy: { completedAt: "desc" }, take: 30 }),
      prisma.learningMaterial.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.dailyReflection.findFirst({ orderBy: { dateKey: "desc" } }),
    ]);
    res.json({ online: online.map((s) => ({ sessionId: s.id, nickname: s.student.nickname, startedAt: s.startedAt, expiresAt: s.expiresAt })), scores: scores.map((s) => ({ id: s.id, nickname: s.student.nickname, score: s.score, total: s.total, completedAt: s.completedAt })), materials, reflection });
  } catch (e) { next(e); }
});

function youtubeVideoId(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
      else if (/^\/(embed|shorts|live)\//.test(url.pathname)) id = url.pathname.split("/")[2] ?? "";
    }
    return /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
const materialSchema = z.object({ title: z.string().trim().min(1).max(120), type: z.enum(["COMIC", "VIDEO"]), url: z.string().trim().min(1).max(1000), emoji: z.string().max(8).default("🌈"), color: z.string().max(20).default("yellow") }).superRefine((data, ctx) => {
  if (data.type === "VIDEO" && !youtubeVideoId(data.url)) ctx.addIssue({ code: "custom", path: ["url"], message: "Video harus berupa tautan YouTube atau youtu.be yang valid." });
});
app.post("/api/admin/materials", teacherOnly, async (req, res, next) => {
  try {
    const data = materialSchema.parse(req.body);
    const id = data.type === "VIDEO" ? youtubeVideoId(data.url) : null;
    const url = id ? `https://www.youtube.com/embed/${id}` : data.url;
    const item = await prisma.learningMaterial.create({ data: { ...data, url, type: data.type as MaterialType } });
    io.emit("materials:updated"); res.status(201).json(item);
  } catch (e) { next(e); }
});
app.delete("/api/admin/materials/:id", teacherOnly, async (req, res, next) => {
  try { await prisma.learningMaterial.delete({ where: { id: String(req.params.id) } }); io.emit("materials:updated"); res.json({ ok: true }); } catch (e) { next(e); }
});
app.put("/api/admin/reflection", teacherOnly, async (req, res, next) => {
  try {
    const body = z.object({ body: z.string().trim().min(1).max(3000) }).parse(req.body).body;
    const dateKey = new Date().toISOString().slice(0, 10);
    const reflection = await prisma.dailyReflection.upsert({ where: { dateKey }, update: { body }, create: { dateKey, body } });
    io.emit("reflection:updated", { body }); res.json(reflection);
  } catch (e) { next(e); }
});

app.get("/api/student/materials", async (_req, res, next) => {
  try { const materials = await prisma.learningMaterial.findMany({ orderBy: { createdAt: "asc" } }); res.json(materials); } catch (e) { next(e); }
});
app.get("/api/student/reflection", async (_req, res, next) => {
  try { const reflection = await prisma.dailyReflection.findFirst({ orderBy: { dateKey: "desc" } }); res.json(reflection ?? { body: "Hari ini kita belajar sambil bermain. Kamu hebat! 🌈" }); } catch (e) { next(e); }
});
app.get("/api/student/session/:id", async (req, res, next) => {
  try {
    const session = await prisma.studentSession.findUnique({ where: { id: req.params.id }, include: { student: true } });
    if (!session || session.endedAt || session.expiresAt <= new Date()) { res.status(410).json({ expired: true }); return; }
    res.json({ id: session.id, nickname: session.student.nickname, startedAt: session.startedAt, expiresAt: session.expiresAt });
  } catch (e) { next(e); }
});
app.post("/api/student/quiz", async (req, res, next) => {
  try {
    const data = z.object({ sessionId: z.string().min(1), score: z.number().int().min(0), total: z.number().int().min(1) }).parse(req.body);
    const session = await prisma.studentSession.findUnique({ where: { id: data.sessionId } });
    if (!session || session.endedAt || session.expiresAt <= new Date()) { res.status(410).json({ error: "Sesi belajar sudah selesai." }); return; }
    if (data.score > data.total || data.total > 50) { res.status(400).json({ error: "Hasil kuis tidak valid." }); return; }
    await prisma.quizAttempt.create({ data: { studentId: session.studentId, score: data.score, total: data.total } });
    io.to("teachers").emit("scores:updated"); res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

io.use(async (socket, next) => {
  const auth = socket.handshake.auth as { role?: string; sessionId?: string };
  if (auth.role === "teacher") {
    try { const token = socket.handshake.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1); const claims = jwt.verify(token ?? "", JWT_SECRET) as { role?: string }; if (claims.role === "teacher") { socket.data.teacher = true; return next(); } } catch { /* reject below */ }
    return next(new Error("unauthorized"));
  }
  if (auth.sessionId) {
    try { const session = await prisma.studentSession.findUnique({ where: { id: auth.sessionId }, include: { student: true } }); if (session && !session.endedAt && session.expiresAt > new Date()) { socket.data.sessionId = session.id; socket.data.studentId = session.studentId; socket.data.nickname = session.student.nickname; return next(); } } catch (e) { return next(e as Error); }
  }
  // First-time student connection is permitted only to submit a nickname via student:join.
  socket.data.newStudent = true;
  next();
});

io.on("connection", (socket) => {
  if (socket.data.teacher) { socket.join("teachers"); void broadcastOnline(); socket.emit("scores:updated"); return; }
  const touchOnline = async () => {
    if (!socket.data.sessionId) return;
    await prisma.studentSession.updateMany({ where: { id: socket.data.sessionId, endedAt: null, expiresAt: { gt: new Date() } }, data: { online: true } });
    void broadcastOnline();
  };
  if (socket.data.sessionId) {
    socket.join(`session:${socket.data.sessionId}`); void touchOnline();
    const session = prisma.studentSession.findUnique({ where: { id: socket.data.sessionId } }).then((s) => s && setTimeout(() => { void expireSession(s.id); }, Math.max(0, s.expiresAt.getTime() - Date.now())));
    void session;
    socket.on("student:heartbeat", () => { if (Date.now() >= socket.data.expiresAt) socket.emit("session:expired"); else void touchOnline(); });
  }
  socket.on("student:join", async (payload: unknown, callback?: (data: unknown) => void) => {
    try {
      if (!socket.data.newStudent || socket.data.sessionId) throw new Error("Sesi ini sudah dimulai.");
      const { nickname } = z.object({ nickname: z.string().trim().min(1).max(30) }).parse(payload);
      const student = await prisma.student.upsert({ where: { nickname }, update: {}, create: { nickname } });
      const startedAt = new Date(); const expiresAt = new Date(startedAt.getTime() + 15 * 60_000);
      const session = await prisma.studentSession.create({ data: { studentId: student.id, startedAt, expiresAt } });
      socket.data.sessionId = session.id; socket.data.studentId = student.id; socket.data.nickname = nickname; socket.data.expiresAt = expiresAt.getTime(); socket.data.newStudent = false; socket.join(`session:${session.id}`);
      setTimeout(() => { void expireSession(session.id); }, 15 * 60_000);
      callback?.({ ok: true, sessionId: session.id, nickname, startedAt, expiresAt });
      io.to("teachers").emit("students:updated"); void broadcastOnline();
    } catch (error) { callback?.({ ok: false, error: error instanceof Error ? error.message : "Gagal memulai sesi." }); }
  });
  socket.on("disconnect", () => { if (socket.data.sessionId) void markOfflineIfNoSockets(socket.data.sessionId); });
});

async function broadcastOnline() {
  const online = await prisma.studentSession.findMany({ where: { online: true, endedAt: null, expiresAt: { gt: new Date() } }, include: { student: true }, orderBy: { startedAt: "desc" } });
  io.to("teachers").emit("students:online", online.map((s) => ({ sessionId: s.id, nickname: s.student.nickname, startedAt: s.startedAt, expiresAt: s.expiresAt })));
}
async function markOfflineIfNoSockets(sessionId: string) {
  setTimeout(async () => {
    if ((await io.in(`session:${sessionId}`).fetchSockets()).length === 0) {
      await prisma.studentSession.updateMany({ where: { id: sessionId, endedAt: null }, data: { online: false } });
      io.to("teachers").emit("students:updated"); void broadcastOnline();
    }
  }, 1500);
}
async function expireSession(sessionId: string) {
  await prisma.studentSession.updateMany({ where: { id: sessionId, endedAt: null, expiresAt: { lte: new Date() } }, data: { endedAt: new Date(), online: false } });
  const session = await prisma.studentSession.findUnique({ where: { id: sessionId } });
  if (session?.endedAt) io.to(`session:${sessionId}`).emit("session:expired");
  io.to("teachers").emit("students:updated"); void broadcastOnline();
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) { res.status(400).json({ error: err.issues[0]?.message ?? "Data tidak valid." }); return; }
  console.error(err); res.status(500).json({ error: "Terjadi kendala. Coba lagi sebentar." });
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => console.log(`PAUD LMS API listening on port ${port}`));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { void io.close(); void prisma.$disconnect(); });

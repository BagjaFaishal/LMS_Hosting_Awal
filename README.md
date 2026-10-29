# Pelangi Belajar 🌈

A playful Indonesian-language PAUD learning app for children ages 4–6, with a teacher dashboard, live student presence, learning materials, quizzes, daily reflections, and a 15-minute session limit.

## Folder structure

```text
apps/
  api/
    prisma/
      schema.prisma       # PostgreSQL schema
      seed.ts             # Starter comics, videos, and today's reflection
    src/index.ts           # Express API and Socket.io server
    .env.example
  web/
    app/                   # Next.js App Router pages and global styles
    components/            # Student experience, teacher dashboard, session state
    lib/                   # API address and editable quiz questions
    public/comics/         # Put your PDF storybooks here
    .env.local.example
.env.example
```

## Database schema

Prisma's source of truth is [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma). It defines:

- `Student`: nickname and relations to their sessions and quiz attempts.
- `StudentSession`: start/expiry timestamps, live online state, and end timestamp.
- `LearningMaterial`: teacher-managed PDF comics and YouTube videos.
- `QuizAttempt`: private score results for the teacher dashboard.
- `DailyReflection`: one saved summary per date.

## Run locally

Requirements: Node.js 20+, npm, and PostgreSQL 14+.

1. Copy `apps/api/.env.example` to `apps/api/.env`. Set `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and a random `JWT_SECRET` with at least 32 characters.
2. Copy `apps/web/.env.local.example` to `apps/web/.env.local` if the API is not at `http://localhost:4000`.
3. From the repository root, run `npm install`, then `npm run db:generate`, `npm run db:push`, and `npm --workspace apps/api run db:seed`.
4. Start the web app and API together with `npm run dev`.
5. Open [http://localhost:3000](http://localhost:3000). The teacher sign-in is at `/teacher`; its credentials are the environment variables you set.

Use a real, unique password and secret for any deployed environment. Teacher authentication uses a 12-hour, HttpOnly cookie and rate-limited login. The student entry has no account: a nickname starts a server-timed learning session.

## Add learning content

- **PDF comics:** put files in `apps/web/public/comics/`, then update the fallback entries in `apps/web/components/student-app.tsx` to use `/comics/your-file.pdf`. The teacher dashboard can also add a comic URL (local public path or hosted PDF).
- **YouTube videos:** replace the `fallbackVideos` embed URLs in `apps/web/components/student-app.tsx`, or add a video from the teacher dashboard. The supplied `https://youtu.be/sRN9RKlMwDQ` link is used as `https://www.youtube.com/embed/sRN9RKlMwDQ`. Teacher entries accept short, watch, shorts, and embed links and normalize them to YouTube embeds; non-YouTube video URLs are rejected.
- **Quiz questions:** edit `apps/web/lib/quiz-data.ts`. Change the prompt, emoji, answer array, and zero-based `correct` answer index. Scores are submitted without displaying them to the student.
- All three insertion points include a `TODO: INSERT YOUR DATA HERE` comment in the source.

## Realtime and scale

Socket.io maintains student presence and emits live session, reflection, material, and score updates. The default setup is a single stateless API process with PostgreSQL connection pooling (`connection_limit` and `pool_timeout` in the example URL), periodic heartbeats, bounded payloads, and indexed session/attempt lookups. This is sufficient as a starting point for 100 concurrent classroom connections; validate against the CPU/memory and database tier chosen for deployment.

For multiple API replicas, set `REDIS_URL` to a reachable Redis instance. The Socket.io Redis adapter publishes events across replicas; configure load-balancer session affinity when long-polling transport is enabled. Use a managed PostgreSQL pooler (such as PgBouncer in transaction mode) before raising replica counts, and ensure the aggregate pool size stays within the database connection limit. Run the API behind a health-checked load balancer and serve the Next.js app separately. Socket state recovery helps with brief network interruptions; PostgreSQL remains the source of truth for session expiry and scores.

The server records an absolute 15-minute expiry at session creation. The client countdown is only a display: API quiz submissions, session lookups, socket reconnects, and server expiry all check the stored deadline.

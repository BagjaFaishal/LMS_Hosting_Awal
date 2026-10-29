"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import { API_URL } from "../lib/config";

export type StudentSession = { sessionId: string; nickname: string; startedAt: string; expiresAt: string };
type ContextValue = { session: StudentSession | null; setSession: (session: StudentSession | null) => void; socket: Socket; expired: boolean; setExpired: (value: boolean) => void };
const SessionContext = createContext<ContextValue | null>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<StudentSession | null>(null);
  const [expired, setExpired] = useState(false);
  const socket = useMemo(() => io(API_URL, { autoConnect: false, transports: ["websocket", "polling"] }), []);
  const setSession = useCallback((next: StudentSession | null) => {
    setSessionState(next);
    if (next) localStorage.setItem("pelangi-session", JSON.stringify(next)); else localStorage.removeItem("pelangi-session");
  }, []);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("pelangi-session");
      if (stored) { const parsed = JSON.parse(stored) as StudentSession; if (new Date(parsed.expiresAt).getTime() > Date.now()) { setSessionState(parsed); socket.auth = { sessionId: parsed.sessionId }; socket.connect(); } else { localStorage.removeItem("pelangi-session"); setExpired(true); } }
    } catch { localStorage.removeItem("pelangi-session"); }
    const onExpired = () => { setExpired(true); setSessionState(null); localStorage.removeItem("pelangi-session"); };
    socket.on("session:expired", onExpired);
    return () => { socket.off("session:expired", onExpired); };
  }, [socket]);
  return <SessionContext.Provider value={{ session, setSession, socket, expired, setExpired }}>{children}</SessionContext.Provider>;
}
export function useStudentSession() { const context = useContext(SessionContext); if (!context) throw new Error("useStudentSession must be used inside SessionProvider"); return context; }

import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "../components/session-provider";

export const metadata: Metadata = {
  title: "Pelangi Belajar — Petualangan Seru!",
  description: "Belajar sambil bermain bersama Pelangi Belajar.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}

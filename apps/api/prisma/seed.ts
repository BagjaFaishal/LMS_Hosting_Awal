import { PrismaClient, MaterialType } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const comics = ["Petualangan Nala", "Kiko Si Kucing", "Kebun Pelangi", "Hari Hujan", "Teman Baru", "Dino Kecil", "Laut Biru", "Bintang Malam"];
  for (const [index, title] of comics.entries()) {
    await prisma.learningMaterial.upsert({ where: { id: `seed-comic-${index + 1}` }, update: {}, create: { id: `seed-comic-${index + 1}`, title, type: MaterialType.COMIC, url: `/placeholders/comic-${index + 1}.pdf`, emoji: ["🦊", "🐱", "🌻", "☔", "🐻", "🦕", "🐠", "🌙"][index], color: ["orange", "pink", "green", "blue", "yellow", "purple", "cyan", "indigo"][index] } });
  }
  const videos = [{ title: "Video Belajar", url: "https://www.youtube.com/embed/sRN9RKlMwDQ" }, { title: "Berhitung Seru", url: "https://www.youtube.com/embed/0TgLtF3PMOc" }, { title: "Lagu Huruf ABC", url: "https://www.youtube.com/embed/75p-N9YKqNo" }];
  for (const [index, video] of videos.entries()) await prisma.learningMaterial.upsert({ where: { id: `seed-video-${index + 1}` }, update: { title: video.title, url: video.url }, create: { id: `seed-video-${index + 1}`, ...video, type: MaterialType.VIDEO, emoji: ["🎨", "🔢", "🔤"][index], color: ["pink", "blue", "green"][index] } });
  await prisma.dailyReflection.upsert({ where: { dateKey: new Date().toISOString().slice(0, 10) }, update: {}, create: { dateKey: new Date().toISOString().slice(0, 10), body: "Hari ini kita belajar warna, berhitung, dan berbagi dengan teman. Kamu hebat sekali! 🌈" } });
}
main().catch((error) => { console.error(error); process.exit(1); }).finally(() => prisma.$disconnect());

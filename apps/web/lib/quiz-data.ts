export type QuizQuestion = { question: string; emoji: string; answers: string[]; correct: number };
// TODO: INSERT YOUR DATA HERE — add or replace questions, answer choices, and the correct answer index.
export const quizQuestions: QuizQuestion[] = [
  { question: "Warna daun biasanya apa?", emoji: "🍃", answers: ["Hijau", "Ungu", "Merah"], correct: 0 },
  { question: "Setelah angka 2 adalah...?", emoji: "🔢", answers: ["1", "3", "5"], correct: 1 },
  { question: "Hewan yang suka mengeong adalah...?", emoji: "🐾", answers: ["Bebek", "Kucing", "Sapi"], correct: 1 },
];

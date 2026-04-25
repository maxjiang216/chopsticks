import { ChopsticksGame } from "@/components/ChopsticksGame";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 md:py-10">
      <header className="text-center md:text-left">
        <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow md:text-4xl">
          Chopsticks
        </h1>
        <p className="mt-1.5 text-base text-slate-300">
          Four variants · four AI levels · engine hints from a full precomputed table
        </p>
      </header>
      <ChopsticksGame />
    </main>
  );
}

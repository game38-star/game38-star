"use client";

export function Dice3D({ value, rolling }: { value: number | null; rolling: boolean }) {
  const faceRotations: Record<number, string> = {
    1: "rotateX(0deg) rotateY(0deg)",
    2: "rotateY(-90deg)",
    3: "rotateX(-90deg)",
    4: "rotateX(90deg)",
    5: "rotateY(90deg)",
    6: "rotateY(180deg)",
  };
  const faces = [
    { n: 1, transform: "translateZ(20px)" },
    { n: 2, transform: "rotateY(90deg) translateZ(20px)" },
    { n: 3, transform: "rotateX(90deg) translateZ(20px)" },
    { n: 4, transform: "rotateX(-90deg) translateZ(20px)" },
    { n: 5, transform: "rotateY(-90deg) translateZ(20px)" },
    { n: 6, transform: "rotateY(180deg) translateZ(20px)" },
  ];
  return (
    <div className="relative h-12 w-12" style={{ perspective: "250px" }} aria-label={rolling ? "Kostka się obraca" : `Kostka: ${value ?? "?"}`}>
      <div className={`absolute left-1 top-1 h-10 w-10 ${rolling ? "bankroll-dice-spin" : ""}`}
        style={{ transformStyle: "preserve-3d", transform: rolling ? undefined : faceRotations[value ?? 1], transition: rolling ? "none" : "transform 450ms ease-out" }}>
        {faces.map((face) => (
          <div key={face.n} className="absolute inset-0 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-xl font-black text-slate-900 shadow-inner"
            style={{ transform: face.transform, backfaceVisibility: "hidden" }}>
            {face.n}
          </div>
        ))}
      </div>
      {!rolling && value === null && <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-amber-300">?</span>}
    </div>
  );
}

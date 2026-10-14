import { useEffect, useRef } from "react";

// 正解時の紙吹雪。左右下のクラッカーから中央上へ 2 段階で噴射し、頂点付近で減速してひらひら舞い落ちる（約3秒）。
// burst が変わるたびに同じキャンバスへ追い足すので、正解が続いても前の紙吹雪が途切れない

type Piece = {
  spark: boolean;
  x: number; y: number; vx: number; vy: number;
  drag: number; fall: number;        // 空気抵抗 (1/s) と終端落下速度 (px/s)
  w: number; h: number; round: boolean;
  rot: number; spin: number;         // 面内の回転
  flip: number; flipSpeed: number;   // 奥行き方向の回転（裏返り）
  swayAmp: number; swayFreq: number; phase: number;
  front: string; back: string; shine: number;
  born: number; life: number;
};

// [表, 裏] の色と、正面を向いたときの光り方。ゴールドは多めに混ぜる
const PALETTE: [string, string, number][] = [
  ["#ffd54a", "#c99a06", 0.9], ["#f7b928", "#a87400", 0.9], ["#ffd54a", "#c99a06", 0.9],
  ["#fff15c", "#c9b800", 0.6],
  ["#ff4fa3", "#b8236c", 0.5], ["#ff8fd0", "#c4528f", 0.5],
  ["#3b9dff", "#1f5fb8", 0.5], ["#4fd8ff", "#1b8fb3", 0.5],
  ["#2fe07a", "#178a46", 0.5], ["#a6ec4f", "#69a51f", 0.5],
];
const SPARK_COLORS = ["#ffffff", "#fff4b8", "#ffe27a"];

const WAVE_DELAY = 0.17;   // 2 段目の噴射までの遅れ (s)
const MAX_PIECES = 1000;   // 正解が重なっても重くならないよう、画面上の紙片数を抑える

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

function cannon(out: Piece[], now: number, W: number, H: number, side: -1 | 1, wave: 0 | 1, amount: number) {
  const s = Math.min(1.6, Math.max(0.75, Math.min(W, H) / 900));
  // 1 段目は中央上へ、2 段目はやや外側の上へ向けて画面全体を埋める
  const tx = W * (side < 0 ? (wave === 0 ? 0.52 : 0.3) : (wave === 0 ? 0.48 : 0.7));
  const ty = H * (wave === 0 ? 0.04 : 0);
  const spread = wave === 0 ? 0.3 : 0.4;
  const papers = Math.round((wave === 0 ? 120 : 90) * amount);
  const sparks = Math.round((wave === 0 ? 16 : 12) * amount);
  for (let i = 0; i < papers + sparks; i++) {
    const spark = i >= papers;
    const x = side < 0 ? rand(-10, W * 0.03) : rand(W * 0.97, W + 10);
    const y = H + rand(-H * 0.03, 10);
    const angle = Math.atan2(ty - y, tx - x) + (Math.random() + Math.random() - 1) * spread;
    // 線形の空気抵抗では到達距離が初速 / drag になるので、狙った距離から初速を決める
    const drag = spark ? rand(4.2, 5.4) : rand(2.9, 4.2);
    const reach = Math.hypot(tx - x, ty - y) * (spark ? rand(0.3, 0.9) : wave === 0 ? rand(0.45, 1.2) : rand(0.4, 1.05));
    const speed = reach * drag;
    const [front, back, shine] = pick(PALETTE);
    const shape = Math.random();
    const strip = !spark && shape < 0.18;
    const round = !spark && shape > 0.88;
    const w = spark ? rand(5, 11) * s : strip ? rand(13, 19) * s : round ? rand(6, 9) * s : rand(8, 14) * s;
    out.push({
      spark, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      drag, fall: H * rand(0.12, 0.24),
      w, h: strip ? 3.2 * s : round ? w : w * rand(0.45, 0.8), round,
      rot: rand(0, Math.PI * 2), spin: rand(6, 14) * (Math.random() < 0.5 ? -1 : 1),
      flip: rand(0, Math.PI * 2), flipSpeed: spark ? rand(16, 28) : rand(6, 16) * (Math.random() < 0.5 ? -1 : 1),
      swayAmp: rand(10, 32) * s, swayFreq: rand(2.2, 4.8), phase: rand(0, Math.PI * 2),
      front: spark ? pick(SPARK_COLORS) : front, back, shine,
      born: now + wave * WAVE_DELAY + rand(0, 0.06),
      life: spark ? rand(0.5, 1.1) : rand(2.45, 2.95) - wave * WAVE_DELAY,
    });
  }
}

function step(p: Piece, age: number, dt: number) {
  const k = Math.exp(-p.drag * dt);
  // 面がこちらを向くほど空気を受けてゆっくり落ち、横を向くと少し速く落ちる
  const fall = p.fall * (1.35 - 0.7 * Math.abs(Math.cos(p.flip)));
  p.vx *= k;
  p.vy = (p.vy - fall) * k + fall;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  // 噴射直後は勢いよく回り、舞い落ちるころには緩やかに回る
  const calm = 0.3 + 0.7 * Math.exp(-2.2 * age);
  p.rot += p.spin * calm * dt;
  p.flip += p.flipSpeed * (p.spark ? 1 : calm) * dt;
}

function draw(ctx: CanvasRenderingContext2D, p: Piece, age: number, remaining: number, dpr: number) {
  const fade = Math.min(1, remaining / Math.min(0.5, p.life * 0.6));
  if (p.spark) {
    const twinkle = 0.5 + 0.5 * Math.sin(p.flip);
    const r = p.w * (0.5 + 0.5 * twinkle);
    ctx.setTransform(dpr, 0, 0, dpr, p.x * dpr, p.y * dpr);
    ctx.rotate(p.rot * 0.2);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = fade * (0.35 + 0.65 * twinkle);
    ctx.fillStyle = p.front;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.quadraticCurveTo(0, 0, 0, r);
    ctx.quadraticCurveTo(0, 0, -r, 0);
    ctx.quadraticCurveTo(0, 0, 0, -r);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  // 減速してから左右に揺れ始め、揺れに合わせて少し傾く
  const sway = smooth((age - 0.35) / 0.7);
  const wave = age * p.swayFreq + p.phase;
  ctx.setTransform(dpr, 0, 0, dpr, (p.x + Math.sin(wave) * p.swayAmp * sway) * dpr, p.y * dpr);
  ctx.rotate(p.rot + Math.cos(wave) * 0.5 * sway);
  const facing = Math.cos(p.flip);
  ctx.scale(1, facing);
  ctx.globalAlpha = fade;
  ctx.fillStyle = facing >= 0 ? p.front : p.back;
  const shape = () => {
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  };
  shape();
  // 正面を向いた瞬間にきらっと光らせる
  const glint = facing > 0 ? facing ** 24 * p.shine : 0;
  if (glint > 0.02) {
    ctx.globalAlpha = fade * glint;
    ctx.fillStyle = "#ffffff";
    shape();
  }
}

function createEngine(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { fire() {}, stop() {} };
  let pieces: Piece[] = [];
  let raf = 0;
  let last = 0;
  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  };
  resize();
  window.addEventListener("resize", resize);

  const frame = (ms: number) => {
    const now = ms / 1000;
    const dt = Math.min(0.1, Math.max(0, now - last));
    last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces = pieces.filter((p) => now < p.born + p.life && p.y < H + 60);
    for (const p of pieces) {
      const age = now - p.born;
      if (age < 0) continue;
      // フレームが落ちても同じ軌道・同じ尺になるよう、1/60 秒刻みで進める
      const span = Math.min(dt, age);
      const n = Math.ceil(span * 60);
      for (let i = 1; i <= n; i++) step(p, age - span + (span * i) / n, span / n);
      draw(ctx, p, age, p.born + p.life - now, dpr);
    }
    ctx.globalAlpha = 1;
    raf = pieces.length ? requestAnimationFrame(frame) : 0;
  };

  return {
    fire() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const now = performance.now() / 1000;
      // 紙吹雪が残っているうちに次の正解が来たら、噴射量を減らして追い足す
      const amount = Math.max(0.2, Math.min(1, (MAX_PIECES - pieces.length) / 480));
      for (const wave of [0, 1] as const) {
        cannon(pieces, now, W, H, -1, wave, amount);
        cannon(pieces, now, W, H, 1, wave, amount);
      }
      if (!raf) { last = now; raf = requestAnimationFrame(frame); }
    },
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    },
  };
}

export function Confetti({ burst }: { burst: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ReturnType<typeof createEngine> | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const e = createEngine(canvasRef.current);
    engine.current = e;
    return () => { e.stop(); engine.current = null; };
  }, []);
  useEffect(() => { if (burst > 0) engine.current?.fire(); }, [burst]);
  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-30 h-full w-full" aria-hidden />;
}

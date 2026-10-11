import { RotateCcw } from "lucide-react";
import { useRouteError } from "react-router-dom";
import { Button } from "./Button";

/** 画面の描画中に例外が起きたときの表示。ルームの状態はサーバーにあるので、再読み込みで復帰できる */
export function AppErrorPage() {
  const error = useRouteError();
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-900 px-6 text-center text-slate-100">
      <h1 className="text-2xl font-black">画面の表示に失敗しました</h1>
      <p className="text-slate-300">再読み込みすると、サーバーに保存されている進行状況から復帰します。</p>
      <Button variant="brand" size="lg" icon={RotateCcw} onClick={() => location.reload()}>再読み込み</Button>
      <p className="max-w-xl break-all font-mono text-xs text-slate-500">{detail}</p>
    </main>
  );
}

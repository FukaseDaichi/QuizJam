import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import { Button } from "../components/Button";

export function AdminGate({ children }: { children: (passphrase: string) => ReactNode }) {
  const [pass, setPass] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = storage.getPassphrase();
    if (!saved) { setChecking(false); return; }
    api.verifyPassphrase(saved)
      .then((ok) => { if (ok) setPass(saved); else storage.setPassphrase(null); })
      .finally(() => setChecking(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await api.verifyPassphrase(input);
    if (ok) { storage.setPassphrase(input); setPass(input); } else setError(true);
  };

  if (checking) return null;
  if (pass) return <>{children(pass)}</>;
  return (
    <main className="flex min-h-full items-center justify-center bg-slate-900 text-slate-100">
      <form onSubmit={submit} className="w-96 rounded-2xl bg-slate-800 p-8">
        <h1 className="flex items-center gap-2 text-2xl font-black"><KeyRound size={24} aria-hidden />管理画面</h1>
        <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="合言葉" className="mt-6 h-12 w-full rounded-xl bg-slate-700 px-4 text-lg" autoFocus />
        {error && <p className="mt-2 text-sm font-bold text-red-400">合言葉が違います</p>}
        <Button type="submit" variant="brand" className="mt-4 w-full">ログイン</Button>
      </form>
    </main>
  );
}

import { WifiOff } from "lucide-react";

export function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div className="qj-slide-in fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-orange-500 py-2 text-sm font-bold text-white" role="status">
      <WifiOff size={16} aria-hidden /> 再接続中…
    </div>
  );
}

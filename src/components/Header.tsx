import { Download } from "lucide-react";

type Props = {
  canExport: boolean;
  onExport: () => void;
};

export function Header({ canExport, onExport }: Props) {
  return (
    <header className="h-14 shrink-0 border-b border-white/10 bg-black px-4 md:px-5">
      <div className="flex h-full items-center justify-between gap-3">
        <img
          src="/omnivisionfull.png"
          alt="Omnivision"
          className="h-8 w-auto"
        />
        <button
          className="inline-flex items-center gap-2 border border-white/10 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-100 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canExport}
          onClick={onExport}
        >
          <Download className="size-4" />
          Export
        </button>
      </div>
    </header>
  );
}

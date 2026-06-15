"use client";
import { useEffect } from "react";
import { X, ExternalLink } from "lucide-react";

export function ImagePopup({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw] rounded-lg bg-white p-3 shadow-2xl animate-in zoom-in-95 fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase tracking-wider text-ink-mid">{alt}</div>
          <div className="flex items-center gap-1">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1.5 hover:bg-brand-yellow-pale"
              title="Open in new tab"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <button onClick={onClose} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Close (Esc)">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-[80vh] max-w-full object-contain" />
      </div>
    </div>
  );
}

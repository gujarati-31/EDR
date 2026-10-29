import React from 'react';

export function getAppIcon(packageName: string, appName: string, size = 32): React.ReactNode {
  const pkg = packageName.toLowerCase();
  const name = appName.toLowerCase();

  // YouTube
  if (pkg.includes('youtube') || name.includes('youtube')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-red-600 flex items-center justify-center text-white shadow-sm flex-shrink-0"
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      </div>
    );
  }

  // WhatsApp
  if (pkg.includes('whatsapp') || name.includes('whatsapp')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-emerald-500 flex items-center justify-center text-white shadow-sm flex-shrink-0"
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor">
          <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c2.2 0 4.26.86 5.82 2.42a8.225 8.225 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.196 8.196 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24zm4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.24-.75-.67-1.25-1.49-1.4-1.74-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.61.13.17 1.78 2.72 4.31 3.81.6.26 1.07.41 1.44.53.61.19 1.16.17 1.6.1.49-.07 1.47-.6 1.68-1.18.21-.59.21-1.09.15-1.19-.06-.1-.23-.16-.48-.28z" />
        </svg>
      </div>
    );
  }

  // Instagram
  if (pkg.includes('instagram') || name.includes('instagram')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-sm flex-shrink-0"
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
      </div>
    );
  }

  // Facebook
  if (pkg.includes('facebook') || name.includes('facebook')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm flex-shrink-0"
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </div>
    );
  }

  // Telegram
  if (pkg.includes('telegram') || name.includes('telegram')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-sky-500 flex items-center justify-center text-white shadow-sm flex-shrink-0"
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
        </svg>
      </div>
    );
  }

  // Free Fire / Free Fire MAX
  if (pkg.includes('freefire') || name.includes('free fire')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-amber-600 flex items-center justify-center text-white shadow-sm flex-shrink-0 font-extrabold text-[10px]"
      >
        🔥FF
      </div>
    );
  }

  // Snapchat
  if (pkg.includes('snapchat') || name.includes('snapchat')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-yellow-400 flex items-center justify-center text-black shadow-sm flex-shrink-0 font-bold text-xs"
      >
        👻
      </div>
    );
  }

  // Cricbuzz
  if (pkg.includes('cricbuzz') || name.includes('cricbuzz')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-green-700 flex items-center justify-center text-white shadow-sm flex-shrink-0 font-bold text-[10px]"
      >
        🏏CB
      </div>
    );
  }

  // Truecaller
  if (pkg.includes('truecaller') || name.includes('truecaller')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-blue-500 flex items-center justify-center text-white shadow-sm flex-shrink-0 font-bold text-xs"
      >
        📞
      </div>
    );
  }

  // Google Chrome
  if (pkg.includes('chrome')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 shadow-sm flex-shrink-0"
      >
        <span className="text-sm font-bold">🌐</span>
      </div>
    );
  }

  // Gmail
  if (pkg.includes('google.android.gm') || name.includes('gmail')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-rose-600 flex items-center justify-center text-white shadow-sm flex-shrink-0"
      >
        <span className="text-xs font-bold">M</span>
      </div>
    );
  }

  // Default Android System App
  if (pkg.startsWith('android') || pkg.startsWith('com.android') || pkg.startsWith('com.google.android.overlay')) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-emerald-950/60 border border-emerald-800/80 flex items-center justify-center text-emerald-400 shadow-sm flex-shrink-0"
      >
        <span className="text-xs">🤖</span>
      </div>
    );
  }

  // Generic User App Icon with initials
  const initials = appName.substring(0, 2).toUpperCase();
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0"
    >
      {initials}
    </div>
  );
}


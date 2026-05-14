"use client";

import { useState } from "react";

type Props = {
  onSubmit: (url: string) => void;
  disabled?: boolean;
};

export function UrlInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim() || disabled) return;
        onSubmit(value.trim());
      }}
      className="flex w-full gap-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://github.com/owner/repo  or  owner/repo"
        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder-neutral-500 outline-none transition-colors focus:border-accent"
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Analyze
      </button>
    </form>
  );
}

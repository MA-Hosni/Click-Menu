"use client";

/* eslint-disable @next/next/no-img-element -- Catalog image URLs may be arbitrary HTTPS URLs or private same-origin image routes; a configured Next image allowlist is not available. */

import { useState } from "react";
import { Utensils } from "lucide-react";

export default function DishPhoto({
  src,
  alt,
  className = "",
  eager = false,
}: {
  src: string | null;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src !== null && failedSrc === src;

  if (!src || failed) {
    return (
      <div className={`photo-fallback ${className}`} role="img" aria-label={alt}>
        <Utensils size={32} />
        <span>{alt}</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  );
}

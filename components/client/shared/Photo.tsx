"use client";

import { useState } from "react";
import { Utensils } from "lucide-react";

export default function Photo({
  src,
  alt,
  className = "",
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return failed ? (
    <div className={`photo-fallback ${className}`} role="img" aria-label={alt}>
      <Utensils size={32} />
      <span>{alt}</span>
    </div>
  ) : (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

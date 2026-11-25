"use client";

import { useEffect, useRef, useState } from "react";

export default function MenuCategoryNavigation({
  categories,
  activeCategory,
  label,
  onSelect,
}: {
  categories: { id: string; label: string }[];
  activeCategory: string;
  label: string;
  onSelect: (category: string) => void;
}) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsMore, setTabsMore] = useState({ start: false, end: false });

  function measureTabs() {
    const element = tabsRef.current;
    if (!element) return;
    const hidden = element.scrollWidth - element.clientWidth;
    const scrolled = Math.abs(element.scrollLeft);
    setTabsMore((current) => {
      const next = { start: scrolled > 24, end: scrolled < hidden - 24 };
      return current.start === next.start && current.end === next.end
        ? current
        : next;
    });
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureTabs);
    window.addEventListener("resize", measureTabs);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measureTabs);
    };
  }, [categories]);

  return (
    <div
      className="category-tabs"
      aria-label={label}
      ref={tabsRef}
      data-more-start={tabsMore.start || undefined}
      data-more-end={tabsMore.end || undefined}
      onScroll={measureTabs}
    >
      {categories.map((category) => (
        <button
          key={category.id}
          aria-pressed={activeCategory === category.id}
          onClick={(event) => {
            onSelect(category.id);
            event.currentTarget.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
              inline: "nearest",
            });
          }}
          className={activeCategory === category.id ? "active" : ""}
        >
          {category.label}
        </button>
      ))}
    </div>
  );
}

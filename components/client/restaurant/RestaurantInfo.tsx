import { ArrowUpRight, Clock3, Leaf, MapPin } from "lucide-react";
import type { Catalog, Language } from "../../../lib/types";
import { copy } from "../copy";
import Photo from "../shared/Photo";

export default function RestaurantInfo({
  catalog,
  language,
}: {
  catalog: Catalog;
  language: Language;
}) {
  const t = copy[language];

  return (
    <>
      <section id="story" className="story-section shell">
        <div className="story-photo" data-reveal>
          <Photo
            src="/images/cafe.jpg"
            alt="Café interior with wooden tables and natural light"
          />
        </div>
        <div
          className="story-copy"
          data-reveal
          style={{ "--reveal-i": 1 } as React.CSSProperties}
        >
          <Leaf size={30} strokeWidth={1.25} />
          <h2>
            {t.about.split("\n").map((line, index) => (
              <span key={index}>{line}</span>
            ))}
          </h2>
          <p>{catalog.settings.description}</p>
          <a className="text-link" href="#visit">
            {t.visit}
            <ArrowUpRight size={18} />
          </a>
        </div>
      </section>
      <section id="visit" className="visit-section shell">
        <h2 data-reveal>{t.visitTitle}</h2>
        <div
          className="visit-detail"
          data-reveal
          style={{ "--reveal-i": 1 } as React.CSSProperties}
        >
          <MapPin size={21} />
          <div>
            <h3>{t.find}</h3>
            <p>{catalog.settings.address}</p>
          </div>
        </div>
        <div
          className="visit-detail"
          data-reveal
          style={{ "--reveal-i": 2 } as React.CSSProperties}
        >
          <Clock3 size={21} />
          <div>
            <h3>{t.hours}</h3>
            <p>{catalog.settings.hours}</p>
          </div>
        </div>
      </section>
    </>
  );
}

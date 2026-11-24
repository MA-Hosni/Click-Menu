import { ArrowDown, Leaf } from "lucide-react";
import type { Language } from "../../../lib/types";
import { copy } from "../copy";
import Photo from "../shared/Photo";

export default function RestaurantHero({
  language,
  tagline,
  restaurantName,
}: {
  language: Language;
  tagline: string;
  restaurantName: string;
}) {
  const t = copy[language];
  const heroText =
    tagline === "Good food. Slow mornings." ? t.hero : tagline;

  return (
    <section className="hero shell" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title" data-reveal>
          {heroText.split("\n").map((line, index) => (
            <span key={index}>{line}</span>
          ))}
        </h1>
        <p data-reveal style={{ "--reveal-i": 1 } as React.CSSProperties}>
          {t.intro}
        </p>
        <a
          href="#menu"
          className="button primary"
          data-reveal
          style={{ "--reveal-i": 2 } as React.CSSProperties}
        >
          {t.explore}
          <ArrowDown size={18} />
        </a>
        <div className="hero-footnote">
          <Leaf size={18} />
          <span>
            {language === "fr"
              ? "De saison. Tout simplement."
              : language === "ar"
                ? "مكونات موسمية. ببساطة."
                : "Seasonal ingredients. Simple pleasures."}
          </span>
        </div>
      </div>
      <div
        className="hero-photos"
        data-reveal
        style={{ "--reveal-i": 1 } as React.CSSProperties}
      >
        <div className="hero-main-frame">
          <Photo
            src="/images/toast.jpg"
            alt="Avocado toast with tomatoes on a ceramic plate"
            className="hero-main-photo"
            eager
          />
        </div>
        <div className="hero-small-photo">
          <Photo src="/images/coffee.jpg" alt="Freshly made coffee" eager />
          <span>
            {language === "fr"
              ? "Encore un café ?"
              : language === "ar"
                ? "قهوة أخرى؟"
                : "One more coffee?"}
          </span>
        </div>
        <div className="hero-photo-caption">
          <span>{restaurantName}</span>
          <span>
            {language === "fr"
              ? "Prenez votre temps."
              : language === "ar"
                ? "خذ وقتك."
                : "Take your time."}
          </span>
        </div>
      </div>
    </section>
  );
}

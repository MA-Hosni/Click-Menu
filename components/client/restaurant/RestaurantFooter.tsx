import { ArrowUpRight } from "lucide-react";
import type { Language } from "../../../lib/types";
import { copy } from "../../../features/storefront/i18n/copy";
import RestaurantBrand from "./RestaurantBrand";

export default function RestaurantFooter({
  restaurantName,
  shop,
  language,
}: {
  restaurantName: string;
  shop: string;
  language: Language;
}) {
  const t = copy[language];

  return (
    <footer className="site-footer">
      <div className="shell footer-top">
        <a
          className="brand"
          href={shop ? `/?shop=${encodeURIComponent(shop)}` : "/"}
        >
          <RestaurantBrand />
          <span>{restaurantName}</span>
        </a>
        <div className="footer-links">
          <a href="/admin">
            {t.owner}
            <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>{t.demoLabel}</span>
        <span>{t.powered} ↗</span>
      </div>
    </footer>
  );
}

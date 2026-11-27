import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { Language } from "../../../lib/types";
import { copy } from "../../../features/storefront/i18n/copy";
import RestaurantBrand from "./RestaurantBrand";

export default function RestaurantFooter({
  restaurantName,
  language,
}: {
  restaurantName: string;
  language: Language;
}) {
  const t = copy[language];

  return (
    <footer className="site-footer">
      <div className="shell footer-top">
        <Link
          className="brand"
          href="/"
        >
          <RestaurantBrand />
          <span>{restaurantName}</span>
        </Link>
        <div className="footer-links">
          <a href="/admin">
            {t.owner}
            <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>{t.powered} ↗</span>
      </div>
    </footer>
  );
}

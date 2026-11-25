import type { Language, OrderType } from "../../../lib/types";
import { formatPrice } from "../../../lib/cart";
import { copy } from "../../../features/storefront/i18n/copy";

export default function CartSummary({
  subtotal,
  deliveryFee,
  total,
  orderType,
  language,
}: {
  subtotal: number;
  deliveryFee: number;
  total: number;
  orderType: OrderType;
  language: Language;
}) {
  const t = copy[language];

  return (
    <div className="order-totals">
      <p>
        <span>{t.subtotal}</span>
        <span>{formatPrice(subtotal, language)}</span>
      </p>
      {orderType === "delivery" && (
        <p>
          <span>{t.deliveryFee}</span>
          <span>{formatPrice(deliveryFee, language)}</span>
        </p>
      )}
      <p className="grand-total">
        <span>{t.total}</span>
        <span>{formatPrice(total, language)}</span>
      </p>
    </div>
  );
}

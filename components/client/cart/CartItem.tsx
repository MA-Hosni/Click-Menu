import { Minus, Plus, X } from "lucide-react";
import type { CartLine } from "../../../lib/cart";
import type { Language } from "../../../lib/types";
import { formatPrice } from "../../../lib/cart";
import { pickText } from "../../../lib/text";
import Photo from "../shared/Photo";

export default function CartItem({
  line,
  language,
  onQuantityChange,
}: {
  line: CartLine;
  language: Language;
  onQuantityChange: (key: string, quantity: number) => void;
}) {
  const name = pickText(line.item.name, language);

  return (
    <div className="cart-line" key={line.key}>
      <Photo src={line.item.image} alt={name} />
      <div className="cart-line-body">
        <div className="cart-line-title">
          <h3>{name}</h3>
          <strong>{formatPrice(line.total, language)} TND</strong>
        </div>
        {line.options.length > 0 && (
          <p>{line.options.map((option) => pickText(option.label, language)).join(", ")}</p>
        )}
        <div className="cart-line-controls">
          <div className="quantity-control">
            <button
              type="button"
              aria-label={`Remove one ${name}`}
              onClick={() => onQuantityChange(line.key, line.quantity - 1)}
            >
              <Minus size={14} />
            </button>
            <output>{line.quantity}</output>
            <button
              type="button"
              aria-label={`Add one ${name}`}
              disabled={line.quantity >= 99}
              onClick={() => onQuantityChange(line.key, line.quantity + 1)}
            >
              <Plus size={14} />
            </button>
          </div>
          <button
            className="remove-line"
            type="button"
            aria-label={`Remove ${name}`}
            onClick={() => onQuantityChange(line.key, 0)}
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

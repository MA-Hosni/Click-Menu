"use client";

import { Minus, Plus, X } from "lucide-react";
import type { Language, MenuItem } from "../../../lib/types";
import { formatPrice } from "../../../lib/cart";
import { pickText } from "../../../lib/text";
import { copy } from "../../../features/storefront/i18n/copy";
import Modal from "../shared/Modal";
import Photo from "../shared/Photo";

export default function MenuItemDetails({
  item,
  language,
  options,
  quantity,
  onClose,
  onOptionsChange,
  onQuantityChange,
  onAdd,
}: {
  item: MenuItem | null;
  language: Language;
  options: string[];
  quantity: number;
  onClose: () => void;
  onOptionsChange: (options: string[]) => void;
  onQuantityChange: (quantity: number) => void;
  onAdd: () => void;
}) {
  const t = copy[language];

  return (
    <Modal open={!!item} onClose={onClose} label={t.customize}>
      {item && (
        <>
          <div className="item-modal-photo">
            <Photo
              src={item.image}
              alt={pickText(item.name, language)}
              eager
            />
            <button
              className="close-button"
              onClick={onClose}
              aria-label={t.close}
            >
              <X size={21} />
            </button>
          </div>
          <div className="item-modal-body">
            <div className="modal-title-row">
              <h2>{pickText(item.name, language)}</h2>
              <strong>{formatPrice(item.price, language)}</strong>
            </div>
            <p>{pickText(item.description, language)}</p>
            {item.options.length > 0 && (
              <fieldset className="extras">
                <legend>{t.extras}</legend>
                {item.options.map((option) => (
                  <label key={option.id}>
                    <input
                      type="checkbox"
                      checked={options.includes(option.id)}
                      onChange={(event) =>
                        onOptionsChange(
                          event.target.checked
                            ? [...options, option.id]
                            : options.filter((id) => id !== option.id),
                        )
                      }
                    />
                    <span>{pickText(option.label, language)}</span>
                    <strong>+{formatPrice(option.price, language)}</strong>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="item-add-row">
              <div className="quantity-control">
                <button
                  aria-label="Decrease quantity"
                  disabled={quantity <= 1}
                  onClick={() => onQuantityChange(quantity - 1)}
                >
                  <Minus size={16} />
                </button>
                <output>{quantity}</output>
                <button
                  aria-label="Increase quantity"
                  disabled={quantity >= 99}
                  onClick={() => onQuantityChange(quantity + 1)}
                >
                  <Plus size={16} />
                </button>
              </div>
              <button className="button primary" onClick={onAdd}>
                {t.addOrder}
                <span>
                  {formatPrice(
                    (item.price +
                      item.options
                        .filter((option) => options.includes(option.id))
                        .reduce((sum, option) => sum + option.price, 0)) *
                      quantity,
                    language,
                  )}
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

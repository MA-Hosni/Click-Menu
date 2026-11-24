"use client";

import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import { ArrowRight } from "lucide-react";
import type { CartLine } from "../../../lib/cart";
import type { Language, OrderDetails, OrderType } from "../../../lib/types";
import { copy } from "../copy";
import CartItem from "../cart/CartItem";
import CartSummary from "../cart/CartSummary";

type CheckoutField = "name" | "table" | "address";

export default function CheckoutForm({
  lines,
  details,
  setDetails,
  language,
  restaurantName,
  subtotal,
  deliveryFee,
  total,
  formError,
  invalid,
  onSubmit,
  onQuantityChange,
  onCheckField,
  onClearField,
}: {
  lines: CartLine[];
  details: OrderDetails;
  setDetails: Dispatch<SetStateAction<OrderDetails>>;
  language: Language;
  restaurantName: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  formError: string;
  invalid: Partial<Record<CheckoutField, boolean>>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onQuantityChange: (key: string, quantity: number) => void;
  onCheckField: (field: CheckoutField) => void;
  onClearField: (field: CheckoutField) => void;
}) {
  const t = copy[language];
  const orderTypes: OrderType[] = ["dine-in", "takeaway", "delivery"];

  return (
    <form className="cart-form" onSubmit={onSubmit} noValidate>
      <div className="cart-lines">
        {lines.map((line) => (
          <CartItem
            key={line.key}
            line={line}
            language={language}
            onQuantityChange={onQuantityChange}
          />
        ))}
      </div>
      <fieldset className="order-types">
        <legend>{t.orderType}</legend>
        <div>
          {orderTypes.map((type) => (
            <label
              key={type}
              className={details.type === type ? "selected" : ""}
            >
              <input
                type="radio"
                name="orderType"
                value={type}
                checked={details.type === type}
                onChange={() => setDetails((current) => ({ ...current, type }))}
              />
              {type === "dine-in"
                ? t.dine
                : type === "takeaway"
                  ? t.takeaway
                  : t.delivery}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="form-field">
        {t.name}
        <input
          name="name"
          required
          maxLength={100}
          autoComplete="name"
          value={details.name}
          aria-invalid={invalid.name || undefined}
          aria-describedby={invalid.name ? "err-name" : undefined}
          onBlur={() => onCheckField("name")}
          onChange={(event) => {
            onClearField("name");
            setDetails((current) => ({ ...current, name: event.target.value }));
          }}
        />
        {invalid.name && (
          <span className="field-error" id="err-name">
            {t.errName}
          </span>
        )}
      </label>
      {details.type === "dine-in" && (
        <label className="form-field">
          {t.table}
          <input
            name="table"
            required
            maxLength={20}
            placeholder="5"
            value={details.table}
            aria-invalid={invalid.table || undefined}
            aria-describedby={invalid.table ? "err-table" : undefined}
            onBlur={() => onCheckField("table")}
            onChange={(event) => {
              onClearField("table");
              setDetails((current) => ({ ...current, table: event.target.value }));
            }}
          />
          {invalid.table && (
            <span className="field-error" id="err-table">
              {t.errTable}
            </span>
          )}
        </label>
      )}
      {details.type === "delivery" && (
        <label className="form-field">
          {t.address}
          <textarea
            name="address"
            required
            minLength={5}
            maxLength={300}
            autoComplete="street-address"
            value={details.address}
            aria-invalid={invalid.address || undefined}
            aria-describedby={invalid.address ? "err-address" : undefined}
            onBlur={() => onCheckField("address")}
            onChange={(event) => {
              onClearField("address");
              setDetails((current) => ({ ...current, address: event.target.value }));
            }}
          />
          {invalid.address && (
            <span className="field-error" id="err-address">
              {t.errAddress}
            </span>
          )}
        </label>
      )}
      <label className="form-field">
        {t.notes}
        <span className="optional">{t.optional}</span>
        <textarea
          maxLength={500}
          placeholder={t.notesPlaceholder}
          value={details.notes}
          onChange={(event) =>
            setDetails((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </label>
      <CartSummary
        subtotal={subtotal}
        deliveryFee={deliveryFee}
        total={total}
        orderType={details.type}
        language={language}
      />
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button className="button primary full-width" type="submit">
        {t.preview}
        <ArrowRight size={18} />
      </button>
      <p className="cart-fine-print">{t.confirm}</p>
      <p className="cart-fine-print">
        {t.privacyNote.replace("{restaurant}", restaurantName)}{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">
          {t.privacy}
        </a>
      </p>
    </form>
  );
}

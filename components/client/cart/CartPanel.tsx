"use client";

import { ArrowRight, ShoppingBag, X } from "lucide-react";
import type { Language } from "../../../lib/types";
import { copy } from "../../../features/storefront/i18n/copy";
import type { useCheckout } from "../../../features/storefront/useCheckout";
import Modal from "../shared/Modal";
import CheckoutForm from "../ordering/CheckoutForm";
import OrderConfirmation from "../ordering/OrderConfirmation";

export default function CartPanel({
  language,
  checkout,
  restaurantName,
  open,
  onClose,
  onQuantityChange,
}: {
  language: Language;
  checkout: ReturnType<typeof useCheckout>;
  restaurantName: string;
  open: boolean;
  onClose: () => void;
  onQuantityChange: (key: string, quantity: number) => void;
}) {
  const t = copy[language];
  const { totals } = checkout;

  return (
    <Modal open={open} onClose={onClose} label={t.cart} drawer>
      <div className="cart-heading">
        <h2>
          {t.cart}
          <span>{totals.itemCount}</span>
        </h2>
        <button className="close-button" onClick={onClose} aria-label={t.close}>
          <X size={22} />
        </button>
      </div>
      {!totals.itemCount ? (
        <div className="empty-cart">
          <ShoppingBag size={45} strokeWidth={1} />
          <h3>{t.empty}</h3>
          <p>{t.emptyText}</p>
          <button className="button primary" onClick={onClose}>
            {t.continue}
            <ArrowRight size={17} />
          </button>
        </div>
      ) : checkout.sent || checkout.message ? (
        <OrderConfirmation
          language={language}
          restaurantName={restaurantName}
          message={checkout.message}
          sent={checkout.sent}
          whatsappUrl={checkout.whatsappUrl}
          formError={checkout.formError}
          copied={checkout.copied}
          onBack={() => checkout.setMessage("")}
          onCopy={() => void checkout.copyMessage()}
          onSend={checkout.recordOrder}
          onNewOrder={checkout.startNewOrder}
        />
      ) : (
        <CheckoutForm
          lines={totals.lines}
          details={checkout.details}
          setDetails={checkout.setDetails}
          language={language}
          restaurantName={restaurantName}
          subtotal={totals.subtotal}
          deliveryFee={totals.deliveryFee}
          total={totals.total}
          formError={checkout.formError}
          invalid={checkout.invalid}
          onSubmit={checkout.preview}
          onQuantityChange={onQuantityChange}
          onCheckField={checkout.checkField}
          onClearField={checkout.clearField}
        />
      )}
    </Modal>
  );
}

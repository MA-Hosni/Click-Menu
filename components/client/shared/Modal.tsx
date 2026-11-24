"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export default function Modal({
  open,
  onClose,
  children,
  label,
  drawer = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>(".modal-inside")?.focus();
    } else if (!open && element.open) {
      element.classList.add("closing");
      const finish = () => {
        element.classList.remove("closing");
        if (element.open) element.close();
      };
      const timer = setTimeout(finish, 220);
      element.addEventListener("animationend", finish, { once: true });
      return () => {
        clearTimeout(timer);
        element.classList.remove("closing");
      };
    }
    if (open) {
      const oldOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = oldOverflow;
      };
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={drawer ? "modal cart-modal" : "modal item-modal"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inside" tabIndex={-1}>
        {children}
      </div>
    </dialog>
  );
}

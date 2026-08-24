import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

interface InertRecord {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
}

function inertOutsideDialog(container: HTMLElement) {
  const records: InertRecord[] = [];
  const shell = container.closest<HTMLElement>(".app-shell");
  let branch: HTMLElement | null = container;

  while (branch?.parentElement && branch !== shell) {
    const parent: HTMLElement = branch.parentElement;
    for (const sibling of parent.children) {
      if (
        sibling === branch ||
        !(sibling instanceof HTMLElement) ||
        sibling.matches(".mobile-drawer-scrim, .mobile-sheet-scrim")
      ) {
        continue;
      }
      records.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = parent;
  }

  return () => {
    for (const record of records) {
      record.element.inert = record.inert;
      if (record.ariaHidden == null) record.element.removeAttribute("aria-hidden");
      else record.element.setAttribute("aria-hidden", record.ariaHidden);
    }
  };
}

export function useDialogFocus<T extends HTMLElement>({
  active = true,
  modal,
  onDismiss,
  initialFocusRef,
  restoreFocusRef,
}: {
  active?: boolean;
  modal: boolean;
  onDismiss: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  restoreFocusRef?: RefObject<HTMLElement>;
}) {
  const dialogRef = useRef<T>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const container = dialogRef.current;
    if (!active || !container) return undefined;

    const previousFocus =
      restoreFocusRef?.current ||
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const restoreInert = modal ? inertOutsideDialog(container) : () => undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      const preferred =
        initialFocusRef?.current ||
        container.querySelector<HTMLElement>(
          "[data-dialog-initial-focus], [autofocus]",
        ) ||
        focusableElements(container)[0] ||
        container;
      preferred.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (!modal || event.key !== "Tab") return;

      const focusable = focusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      const current = document.activeElement;
      if (!container.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      restoreInert();
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      });
    };
  }, [active, initialFocusRef, modal, restoreFocusRef]);

  return dialogRef;
}

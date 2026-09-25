import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

const STORAGE_PREFIX = "postbus.tour.dashboard.v1:";

const STEP_DEFS: DriveStep[] = [
  {
    element: "#main-content",
    popover: {
      title: "Welcome to PostBus",
      description:
        "This workspace is where orders become shipments: book India Post, print labels, and keep customers updated.",
    },
  },
  {
    element: "[data-tour='nav']",
    popover: {
      title: "Your shipping work lives here",
      description:
        "Use the sidebar to move between orders, shipments, labels, tracking, and the rest of the product.",
    },
  },
  {
    element: "[data-tour='nav-orders']",
    popover: {
      title: "Orders",
      description: "Import from Shopify or add a manual order, then select what is ready to book.",
    },
  },
  {
    element: "[data-tour='nav-shipments']",
    popover: {
      title: "Shipments",
      description: "After you book, shipments show booking status, tracking, and what still needs a label.",
    },
  },
  {
    element: "[data-tour='nav-labels']",
    popover: {
      title: "Labels",
      description: "Print and reprint India Post labels from here once a shipment is booked.",
    },
  },
  {
    element: "[data-tour='nav-integrations']",
    popover: {
      title: "Integrations",
      description: "Connect Shopify for order intake and India Post for booking. Start here if this workspace is new.",
    },
  },
  {
    element: "[data-tour='search']",
    popover: {
      title: "Jump anywhere",
      description: "Search orders and pages with ⌘K (Ctrl+K on Windows) without leaving the keyboard.",
    },
  },
  {
    element: "[data-tour='ready-to-ship']",
    popover: {
      title: "Ready to ship",
      description:
        "Select orders in the table below, then ship them from here. Connect Shopify if you still need orders flowing in.",
    },
  },
  {
    element: "[data-tour='kpis']",
    popover: {
      title: "How the pipeline is doing",
      description: "These cards summarize orders, bookings, transit, deliveries, and failures for the date range you pick.",
    },
  },
  {
    element: "[data-tour='recent-orders']",
    popover: {
      title: "Recent orders",
      description: "Open an order for details, or select rows to book.",
    },
  },
];

let active: Driver | null = null;
let persistOnDestroy = true;

export function tourStorageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export function hasCompletedDashboardTour(userId: string) {
  try {
    return window.localStorage.getItem(tourStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markDashboardTourComplete(userId: string) {
  try {
    window.localStorage.setItem(tourStorageKey(userId), "1");
  } catch {
    // private mode / blocked storage should not block the overlay from closing
  }
}

function isHighlightableEl(el: HTMLElement) {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function resolveElement(selector: string) {
  const nodes = document.querySelectorAll(selector);
  for (const el of nodes) {
    if (el instanceof HTMLElement && isHighlightableEl(el)) return el;
  }
  return undefined;
}

function visibleSteps(): DriveStep[] {
  const steps: DriveStep[] = [];
  for (const step of STEP_DEFS) {
    if (typeof step.element !== "string") {
      steps.push(step);
      continue;
    }
    const element = resolveElement(step.element);
    if (!element) continue;
    steps.push({ ...step, element });
  }
  return steps;
}

export function destroyDashboardTour() {
  const current = active;
  active = null;
  persistOnDestroy = false;
  current?.destroy();
  persistOnDestroy = true;
}

export function startDashboardTour(options: { userId: string }) {
  if (hasCompletedDashboardTour(options.userId)) return;

  destroyDashboardTour();

  const steps = visibleSteps();
  if (steps.length === 0) return;

  const userId = options.userId;
  markDashboardTourComplete(userId);
  active = driver({
    steps,
    showProgress: true,
    allowClose: true,
    skipMissingElement: true,
    overlayColor: "#09090b",
    overlayOpacity: 0.55,
    stagePadding: 8,
    stageRadius: 14,
    popoverClass: "driver-popover-postbus",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    onDestroyed: () => {
      if (persistOnDestroy) markDashboardTourComplete(userId);
      active = null;
    },
  });
  active.drive();
}

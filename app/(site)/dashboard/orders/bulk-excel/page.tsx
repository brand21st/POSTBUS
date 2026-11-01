"use client";

import { Suspense } from "react";
import { BulkBookingPage } from "@/components/booking-queue/bulk-booking-page";

export default function BulkExcelBookingPage() {
  return (
    <Suspense fallback={null}>
      <BulkBookingPage />
    </Suspense>
  );
}

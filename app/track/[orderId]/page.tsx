import type { Metadata } from "next";
import { Suspense } from "react";
import CustomerOrderTracking from "../../../components/client/ordering/CustomerOrderTracking";

export const metadata: Metadata = {
  title: "Order tracking · The Hood",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

async function TrackingContent({ params }: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <CustomerOrderTracking orderId={orderId} />;
}

export default function CustomerOrderTrackingRoute({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  return (
    <Suspense fallback={<main className="customer-tracking-page" aria-busy="true" />}>
      <TrackingContent params={params} />
    </Suspense>
  );
}

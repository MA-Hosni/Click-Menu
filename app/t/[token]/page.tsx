import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import RestaurantPage from "../../../components/client/restaurant/RestaurantPage";
import { createRestaurantTableStore } from "../../../lib/table-store";
import { createTableOperations } from "../../../lib/table-operations";
import { readPublicCatalog } from "../../../lib/catalog-store";
import { loadPublicTableMenu } from "../../../lib/public-table-menu";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function TableMenuRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense fallback={<p className="table-menu-loading">Loading table menu…</p>}>
      <ResolvedTableMenu params={params} />
    </Suspense>
  );
}

async function ResolvedTableMenu({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const tables = createTableOperations(createRestaurantTableStore(), {
    siteUrl: process.env.SITE_URL,
  });
  const data = await loadPublicTableMenu(token, {
    resolveTable: tables.resolve,
    readCatalog: readPublicCatalog,
  });
  if (!data) {
    return (
      <main className="table-qr-unavailable" role="alert">
        <p className="eyebrow">The Hood</p>
        <h1>This table QR link is unavailable</h1>
        <p>Ask restaurant staff for the current QR code for your table.</p>
      </main>
    );
  }

  return (
    <RestaurantPage
      menuOnly
      tableLabel={data.tableLabel}
      dineInTableToken={token}
      initialCatalog={data.catalog}
    />
  );
}

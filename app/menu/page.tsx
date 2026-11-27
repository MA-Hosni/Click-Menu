import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import RestaurantPage from "../../components/client/restaurant/RestaurantPage";
import { readPublicCatalog } from "../../lib/catalog-store";

/**
 * A shared menu link previews as the restaurant itself: its name, tagline,
 * and first dish photo.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  await searchParams;
  try {
    const catalog = await readPublicCatalog();
    if (!catalog) return {};
    const { settings, items } = catalog;
    const title = `${settings.name} · Menu`;
    const description = settings.tagline.replace(/\s+/g, " ");
    const photo = items.find((item) => item.available)?.image;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        images: photo ? [{ url: photo }] : undefined,
      },
    };
  } catch {
    // A preview is a nicety; the menu itself must still load.
    return {};
  }
}

async function RequestTimeMetadataBoundary() {
  await connection();
  return null;
}

export default function Menu() {
  return (
    <>
      <RestaurantPage menuOnly />
      <Suspense fallback={null}>
        <RequestTimeMetadataBoundary />
      </Suspense>
    </>
  );
}

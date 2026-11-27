"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "../../../features/admin/AdminProvider";

interface CatalogReviewState {
  revision: number;
  reviewedRevision: number | null;
  reviewedAt: number | null;
}

export default function TndPriceReview() {
  const { saved, dirty, saving, t, reload } = useAdmin();
  const [review, setReview] = useState<CatalogReviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingReview, setSavingReview] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshReview = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/catalog/review", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(t.tndReviewLoadError);
      setReview(data as CatalogReviewState);
      setError("");
    } catch {
      setReview(null);
      setError(t.tndReviewLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.tndReviewLoadError]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshReview(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshReview, saved.revision]);

  const reviewed = Boolean(
    !dirty &&
      review &&
      review.revision === saved.revision &&
      review.reviewedRevision === saved.revision &&
      review.reviewedAt !== null,
  );
  const currentStateKnown = Boolean(review && review.revision === saved.revision);

  async function confirmReview() {
    if (!window.confirm(t.tndReviewConfirm)) return;

    setSavingReview(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/catalog/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: saved.revision }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          await reload(t);
          await refreshReview();
        }
        if (response.status === 409) throw new Error(t.tndReviewConflict);
        if (response.status === 422) throw new Error(t.tndReviewInvalidCatalog);
        throw new Error(t.tndReviewFailed);
      }

      await reload(t);
      await refreshReview();
      setNotice(t.tndReviewSuccess);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.tndReviewFailed);
    } finally {
      setSavingReview(false);
    }
  }

  return (
    <section className="admin-setting-section" aria-labelledby="tnd-price-review-title">
      <div>
        <h2 id="tnd-price-review-title">{t.tndReviewTitle}</h2>
        <p>{t.tndReviewExplanation}</p>
      </div>
      <div>
        {loading ? (
          <p role="status">{t.tndReviewLoading}</p>
        ) : reviewed ? (
          <p role="status">{t.tndReviewReviewed(saved.revision)}</p>
        ) : dirty ? (
          <p role="status">{t.tndReviewUnsaved}</p>
        ) : !currentStateKnown ? (
          <p role="status">{t.tndReviewRefreshRequired}</p>
        ) : (
          <p role="status">{t.tndReviewUnreviewed(saved.revision)}</p>
        )}
        <p className="admin-note">{t.tndReviewNoConversion}</p>
        <p className="admin-note">{t.tndReviewEditInvalidates}</p>
        {error && <p className="admin-message admin-message-error" role="alert">{error}</p>}
        {notice && <p className="admin-message" role="status">{notice}</p>}
        <button
          type="button"
          className="admin-secondary"
          onClick={() => void confirmReview()}
          disabled={
            loading || savingReview || saving || dirty || saved.revision < 1 ||
            !currentStateKnown || reviewed
          }
        >
          {savingReview ? t.tndReviewSaving : t.tndReviewButton}
        </button>
      </div>
    </section>
  );
}

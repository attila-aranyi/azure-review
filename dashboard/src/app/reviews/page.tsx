"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type Review, type ReviewDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, Text } from "@tremor/react";
import { ChevronLeft, ThumbsUp, ThumbsDown, RotateCcw } from "lucide-react";

function ReviewList({ onSelect }: { onSelect: (id: string) => void }) {
  const { authenticated } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    api.listReviews({ page, limit }).then((res) => {
      setReviews(res.data);
      setTotal(res.total);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [authenticated, page]);

  if (loading) return <div className="text-zinc-400">Loading reviews...</div>;

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reviews</h1>
          <p className="text-sm text-zinc-400 mt-1">{total} total reviews</p>
        </div>
      </div>

      <Card className="bg-zinc-900 border-zinc-800 ring-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left py-3 px-4 font-medium">PR</th>
              <th className="text-left py-3 px-4 font-medium">Repository</th>
              <th className="text-left py-3 px-4 font-medium">Status</th>
              <th className="text-left py-3 px-4 font-medium">Hunks</th>
              <th className="text-left py-3 px-4 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((r) => (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="border-b border-zinc-800/50 cursor-pointer hover:bg-zinc-800/50 transition-colors"
              >
                <td className="py-3 px-4 text-white font-medium">#{r.prId}</td>
                <td className="py-3 px-4 text-zinc-300 font-mono text-xs">{r.repoId.slice(0, 12)}...</td>
                <td className="py-3 px-4">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    r.status === "completed" ? "bg-green-900/50 text-green-400" :
                    r.status === "failed" ? "bg-red-900/50 text-red-400" :
                    r.status === "pending" ? "bg-yellow-900/50 text-yellow-400" :
                    "bg-blue-900/50 text-blue-400"
                  }`}>
                    {r.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-zinc-400">{r.hunksProcessed ?? "-"}</td>
                <td className="py-3 px-4 text-zinc-400">{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded text-sm text-zinc-400 hover:text-white disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-400">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded text-sm text-zinc-400 hover:text-white disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewDetailView({ reviewId, onBack }: { reviewId: string; onBack: () => void }) {
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getReview(reviewId).then(setReview).catch(() => {}).finally(() => setLoading(false));
  }, [reviewId]);

  if (loading) return <div className="text-zinc-400">Loading review...</div>;
  if (!review) return <div className="text-red-400">Review not found</div>;

  const severityColor: Record<string, string> = {
    critical: "bg-red-900/50 text-red-400",
    high: "bg-orange-900/50 text-orange-400",
    medium: "bg-yellow-900/50 text-yellow-400",
    low: "bg-blue-900/50 text-blue-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-zinc-400 hover:text-white transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">PR #{review.prId}</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {review.status} &middot; {review.findings.length} findings &middot; {new Date(review.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => api.retriggerReview(review.id).catch(() => {})}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> Re-run
        </button>
      </div>

      {review.findings.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <Text className="text-zinc-500">No findings for this review.</Text>
        </Card>
      ) : (
        <div className="space-y-3">
          {review.findings.map((f) => (
            <Card key={f.id} className="bg-zinc-900 border-zinc-800 ring-0">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${severityColor[f.severity] ?? "bg-zinc-800 text-zinc-400"}`}>
                      {f.severity}
                    </span>
                    <span className="text-xs text-zinc-500 font-medium uppercase">{f.issueType}</span>
                  </div>
                  <p className="text-sm text-white">{f.message}</p>
                  <p className="text-xs text-zinc-500 mt-1 font-mono">
                    {f.filePath}:{f.startLine}-{f.endLine}
                  </p>
                  {f.suggestion && (
                    <pre className="mt-2 text-xs bg-zinc-800 rounded p-2 text-green-400 overflow-x-auto">{f.suggestion}</pre>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => api.submitFeedback(review.id, f.id, "up").catch(() => {})}
                    className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-green-400 transition-colors"
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => api.submitFeedback(review.id, f.id, "down").catch(() => {})}
                    className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReviewsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <AppShell>
      {selectedId ? (
        <ReviewDetailView reviewId={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <ReviewList onSelect={setSelectedId} />
      )}
    </AppShell>
  );
}

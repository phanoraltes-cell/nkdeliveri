import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Pwofil mwen — NK Delivery" }] }),
  component: Profile,
});

function Profile() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[640px] px-5 py-12">
        <h1 className="mb-3 font-display text-2xl font-extrabold">Pwofil</h1>
        <div className="rounded-[18px] bg-white p-6 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
          {user ? (
            <div className="space-y-2 text-sm">
              <div><b>Email:</b> {user.email}</div>
              <div className="text-ink-soft">Plis opsyon (adrès, telefòn, avatar) ap disponib byento.</div>
            </div>
          ) : (
            <div className="text-ink-soft">Konekte pou wè pwofil ou.</div>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
import { Link, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingBag, User as UserIcon, LogOut, LayoutDashboard } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const { user } = useAuth();
  const { count } = useCart();
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
  }

  return (
    <header className="sticky top-[calc(1rem+var(--sat))] z-50 pl-[max(1rem,var(--sal))] pr-[max(1rem,var(--sar))]">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-1.5 rounded-full border border-brand-soft/60 bg-white/95 px-3 shadow-[0_10px_30px_rgba(249,115,22,0.10)] backdrop-blur sm:h-20 sm:gap-3 sm:px-5">
        <Link to="/" className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2.5">
          {/* Icon grown ~25-27% (32→40px mobile, 44→56px sm+) — text
              branding next to it deliberately untouched (still text-base/
              text-xl below). width/height bumped to match the new sm+
              rendered size so the intrinsic-size CLS hint stays accurate. */}
          <img
            src="/nk-logo.png"
            alt="NK Deliveri"
            width={56}
            height={56}
            className="h-10 w-10 shrink-0 rounded-full object-contain sm:h-14 sm:w-14"
          />
          <div className="min-w-0">
            <div className="truncate font-display text-base font-extrabold tracking-tight leading-none text-ink sm:text-xl">
              NK <span className="text-brand">Deliveri</span>
            </div>
            {/* Redundant with the bottom nav / footer on small screens — cut first when space is tight. */}
            <div className="hidden text-[0.7rem] uppercase tracking-widest text-ink-soft sm:block">
              Gonaïves
            </div>
          </div>
        </Link>

        <nav className="mx-auto hidden items-center gap-1 md:flex">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            activeProps={{ className: "!text-brand after:!scale-x-100" }}
            className="relative px-4 py-2 text-sm font-semibold text-ink transition hover:text-brand after:absolute after:left-4 after:right-4 after:-bottom-0.5 after:h-[3px] after:origin-center after:scale-x-0 after:rounded-full after:bg-brand after:transition-transform"
          >
            Akèy
          </Link>
          <Link
            to="/restaurants"
            activeProps={{ className: "!text-brand after:!scale-x-100" }}
            className="relative px-4 py-2 text-sm font-semibold text-ink transition hover:text-brand after:absolute after:left-4 after:right-4 after:-bottom-0.5 after:h-[3px] after:origin-center after:scale-x-0 after:rounded-full after:bg-brand after:transition-transform"
          >
            Restoran
          </Link>
          <Link
            to="/orders"
            activeProps={{ className: "!text-brand after:!scale-x-100" }}
            className="relative px-4 py-2 text-sm font-semibold text-ink transition hover:text-brand after:absolute after:left-4 after:right-4 after:-bottom-0.5 after:h-[3px] after:origin-center after:scale-x-0 after:rounded-full after:bg-brand after:transition-transform"
          >
            Kòmand mwen
          </Link>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <Link
            to="/checkout"
            aria-label="Panye"
            className="relative inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand-soft/70 px-3 text-sm font-bold text-brand-deep transition hover:bg-brand-soft sm:px-4"
          >
            <ShoppingBag className="h-4 w-4" />
            <span className="hidden sm:inline">Panye</span>
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[0.68rem] font-bold text-white">
                {count}
              </span>
            )}
          </Link>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="Meni kont">
                  <UserIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/dashboard">
                    <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/profile">Pwofil mwen</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/orders">Kòmand mwen</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Dekonekte
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/auth"
                className="hidden rounded-full border-2 border-brand-soft bg-white px-4 py-2 text-sm font-bold text-brand-deep transition hover:bg-brand-soft/50 sm:inline-block"
              >
                Konekte
              </Link>
              <Button asChild className="px-3.5 sm:px-5">
                <Link to="/auth/register">Enskri</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

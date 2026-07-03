import { Link, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useCart } from "@/hooks/use-cart";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingBag, User as UserIcon, LogOut } from "lucide-react";
import nkLogo from "@/assets/nk-logo.png.asset.json";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SiteHeader() {
  const { user } = useAuth();
  const { count } = useCart();
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
  }

  return (
    <header className="sticky top-4 z-50 px-4">
      <div className="mx-auto flex h-20 max-w-[1200px] items-center gap-3 rounded-full border border-brand-soft/60 bg-white/95 px-5 shadow-[0_10px_30px_rgba(249,115,22,0.10)] backdrop-blur">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src={nkLogo.url}
            alt="NK Delivery"
            width={44}
            height={44}
            className="h-11 w-11 rounded-full object-contain"
          />
          <div>
            <div className="font-display text-xl font-extrabold tracking-tight leading-none text-ink">
              NK <span className="text-brand">Delivery</span>
            </div>
            <div className="text-[0.7rem] uppercase tracking-widest text-ink-soft">
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

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/checkout"
            className="relative inline-flex items-center gap-2 rounded-full bg-brand-soft/70 px-4 py-2.5 text-sm font-bold text-brand-deep transition hover:bg-brand-soft"
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
              <DropdownMenuTrigger className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white transition hover:bg-brand-deep">
                <UserIcon className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
            <Link
              to="/auth"
              className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-[0_6px_18px_rgba(249,115,22,0.35)] transition hover:bg-brand-deep hover:shadow-[0_10px_24px_rgba(249,115,22,0.45)]"
            >
              Konekte
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
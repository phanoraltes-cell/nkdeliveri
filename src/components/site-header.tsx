import { Link, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useCart } from "@/hooks/use-cart";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingBag, User as UserIcon, LogOut } from "lucide-react";
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
    <header className="sticky top-0 z-50 bg-white shadow-[0_2px_12px_rgba(43,26,14,0.06)]">
      <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-5 py-2.5">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white font-display font-extrabold text-lg">
            NK
          </div>
          <div>
            <div className="font-display text-xl font-extrabold tracking-tight leading-none">
              NK <span className="text-brand">Delivery</span>
            </div>
            <div className="text-[0.7rem] uppercase tracking-widest text-ink-soft">
              Gonaïves
            </div>
          </div>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            activeProps={{ className: "!bg-brand !text-white" }}
            className="hidden sm:inline-block rounded-full px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-brand-soft hover:text-brand-deep"
          >
            Akèy
          </Link>
          <Link
            to="/restaurants"
            activeProps={{ className: "!bg-brand !text-white" }}
            className="hidden sm:inline-block rounded-full px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-brand-soft hover:text-brand-deep"
          >
            Restoran
          </Link>
          <Link
            to="/orders"
            activeProps={{ className: "!bg-brand !text-white" }}
            className="hidden sm:inline-block rounded-full px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-brand-soft hover:text-brand-deep"
          >
            Kòmand mwen
          </Link>

          <Link
            to="/checkout"
            className="relative inline-flex items-center gap-2 rounded-full bg-brand-soft px-4 py-2 text-sm font-bold text-brand-deep transition hover:bg-brand hover:text-white"
          >
            <ShoppingBag className="h-4 w-4" />
            Panye
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[0.68rem] font-bold text-white">
                {count}
              </span>
            )}
          </Link>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white">
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
              className="ml-1 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white transition hover:bg-ink/90"
            >
              Konekte
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
import { Link } from "@tanstack/react-router";
import { isWalletActive, type WalletDisplayState } from "@/lib/wallet-payment-display";
import { Wallet, Check, Banknote } from "lucide-react";
import { formatHTG } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  getProviderSetting,
  isProviderEnabled,
  type PaymentProviderSetting,
} from "@/lib/payment-provider-availability";

/**
 * Metòd peman "klasik" yo — sa yo ki mande yon aksyon kliyan. Wallet la PA
 * nan lis sa a: depi Tach 1, wallet la se pa yon chwa nan menm nivo ak lòt
 * yo, se yon desizyon SÈVÈ a pran (wè migrasyon 20260904000000). Li gen
 * pwòp liy pa l anwo lis la.
 */
export const OTHER_METHODS = [
  {
    id: "moncash_auto",
    label: "MonCash Otomatik",
    sub: "Peman otomatik, konfimasyon imedya",
    logo: "/moncash-logo-hero.png",
  },
  {
    id: "natcash_auto",
    label: "NatCash Otomatik",
    sub: "Peman otomatik, konfimasyon imedya",
    logo: "/natcash-logo-new.png",
  },
  {
    id: "stripe",
    label: "Kat Kredi",
    sub: "Peman ak kat, konfimasyon imedya",
    logo: "/stripe-card-logo.svg",
  },
  // YON SÈL antre pou peman manyèl la (2026-09, sou demann Altes). Anvan,
  // "MonCash Manyèl" ak "NatCash" te de bouton separe ki te mande menm
  // bagay la: peye alamen epi voye yon prèv. Kliyan an te oblije chwazi
  // yon rezo AVAN li wè nimewo a. Kounye a li klike yon sèl fwa epi li wè
  // TOUDE nimewo yo, epi li peye sou sa l vle.
  {
    id: "manyel",
    label: "MonCash oswa NatCash",
    sub: "Peman manyèl ak prèv",
    logo: "/moncash-logo-hero.png",
    secondLogo: "/natcash-logo-new.png",
  },
  // Kach pa gen yon logo pwovidè — pa gen konpayi dèyè l. Li pote ikòn
  // biyè a nan menm kad la ak lòt yo, pou liy lan pa parèt kase ak yon
  // bwat vid pandan chak lòt metòd gen yon imaj.
  { id: "kach", label: "Kach nan livrezon", sub: "Peye lè manje a rive", logo: null, icon: "cash" },
] as const;

export type CheckoutMethod = (typeof OTHER_METHODS)[number]["id"];

/** Nimewo yon rezo manyèl, jan `platform_payout_settings` bay li. */
export type ManualAccount = { number: string | null; name: string | null };

export type PayableWallet = {
  wallet_id: string | null;
  label: string;
  available_balance: number;
  self_order_blocked: boolean;
};

type Props = {
  providerSettings: PaymentProviderSetting[];
  method: CheckoutMethod;
  onSelectMethod: (id: CheckoutMethod) => void;
  walletState: WalletDisplayState;
  /** Kliyan an klike "Peye ak yon lòt metòd" — sèl bagay li ka di sou wallet la. */
  walletOptOut: boolean;
  onWalletOptOut: (optOut: boolean) => void;
  /** Tach 3C — pikè a parèt sèlman si gen plis pase yon wallet ki ka peye. */
  wallets: PayableWallet[];
  selectedWalletId: string | null;
  onSelectWallet: (walletId: string | null) => void;
  /** De kont manyèl yo — toude parèt ansanm lè kliyan an chwazi peman manyèl. */
  manualAccounts: { moncash: ManualAccount; natcash: ManualAccount };
};

export function PaymentMethodsSection({
  providerSettings,
  method,
  onSelectMethod,
  walletState,
  walletOptOut,
  onWalletOptOut,
  wallets,
  selectedWalletId,
  onSelectWallet,
  manualAccounts,
}: Props) {
  // Wallet la aktif SÈLMAN nan ka 1 epi si kliyan an pa t chwazi yon lòt
  // metòd. Nan tout lòt ka, lòt metòd yo se sa k ap sèvi.
  const walletActive = isWalletActive(walletState, walletOptOut);
  const otherMethodsMuted = walletActive;

  return (
    <section aria-labelledby="checkout-payment-title" className="min-w-0">
      <h2 id="checkout-payment-title" className="mb-3 font-display text-base font-bold text-ink">
        Kijan w ap peye
      </h2>

      {/* PA `role="radiogroup"` isit la: veso a genyen lòt bagay ki pa
          radyo (pikè wallet la, lyen "Peye ak yon lòt metòd"), epi yon
          radiogroup ki gen pitit ki pa radyo twonpe lektè ekran yo. Radyo
          natif yo pataje menm `name="payment-method"` — sa a KÒM SA gwoupe
          yo pou teknoloji asistans, san okenn ARIA. */}
      <div className="space-y-2">
        {/* ---------- Liy wallet la (toujou an premye) ---------- */}
        {walletState.kind === "loading" && (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-brand-soft/60 bg-white p-3">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-brand-soft/60" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3 w-28 animate-pulse rounded bg-brand-soft/60" />
              <div className="h-2.5 w-40 animate-pulse rounded bg-brand-soft/40" />
            </div>
            <span className="sr-only">N ap tcheke balans wallet ou…</span>
          </div>
        )}

        {walletState.kind === "sufficient" && (
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 transition focus-within:ring-2 focus-within:ring-brand/40 ${
              walletActive
                ? "border-status-good bg-status-good-soft"
                : "border-brand-soft bg-white hover:border-brand"
            }`}
          >
            {/* Radyo natif la RETE VIZIB. Yon `sr-only` t ap bay menm
                semantik la pou yon lektè ekran, men li retire sèl endikatè
                vizyèl ki di "sa a se yon chwa" — sou yon paj peman se
                egzakteman sa moun nan bezwen wè. */}
            <input
              type="radio"
              name="payment-method"
              className="h-4 w-4 shrink-0 accent-brand"
              checked={walletActive}
              onChange={() => onWalletOptOut(false)}
              aria-label={`Wallet ou, balans ${formatHTG(walletState.balance)} — total kòmand la ap retire dirèkteman`}
            />
            <span
              aria-hidden="true"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                walletActive ? "bg-status-good text-white" : "bg-brand-soft text-brand-deep"
              }`}
            >
              {walletActive ? <Check className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink">
                Wallet ou · Balans {formatHTG(walletState.balance)}
              </span>
              {/* Menm rezon ak kat metòd ki chwazi a: fon tente + ink-soft
                  tonbe anba WCAG AA. */}
              <small
                className={`mt-0.5 block text-xs font-normal ${walletActive ? "text-ink" : "text-ink-soft"}`}
              >
                Total kòmand la ap retire dirèkteman
              </small>
            </span>
          </label>
        )}

        {walletState.kind === "insufficient" && (
          <div className="rounded-2xl border-2 border-brand-soft/60 bg-cream p-3">
            <div className="flex items-center gap-3 opacity-70">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft/70 text-brand-deep"
              >
                <Wallet className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">Wallet ou</span>
                <small className="mt-0.5 block text-xs font-normal text-ink-soft">
                  Balans {formatHTG(walletState.balance)} ·{" "}
                  <b className="text-destructive">{formatHTG(walletState.missing)} manke</b>
                </small>
              </span>
            </div>
            {/* Panye a rete nan localStorage (`nk-cart-v1`), donk ale rechaje
                epi retounen pa pèdi anyen. `next` fè paj wallet la ofri yon
                retou dirèk sou checkout la olye moun nan chèche l li menm. */}
            <Link
              to="/dashboard/customer/wallet"
              search={{ next: "/checkout" }}
              className="mt-2.5 flex h-10 w-full items-center justify-center rounded-xl bg-brand px-4 text-sm font-bold text-white transition hover:bg-brand-deep focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
            >
              Ajoute lajan
            </Link>
          </div>
        )}

        {/* Tach 3C — plizyè wallet (restoran/livrè ki gen pwòp wallet yo).
            Yon kliyan òdinè pa janm wè blòk sa a. */}
        {walletActive && wallets.length > 1 && (
          <fieldset className="rounded-2xl border border-brand-soft bg-white p-3">
            <legend className="px-1 text-xs font-bold text-ink-soft">Ki wallet</legend>
            <div className="flex flex-col gap-1.5">
              {wallets.map((w) => (
                <label
                  key={w.wallet_id ?? "customer-default"}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border-2 px-3 py-2 text-xs ${
                    selectedWalletId === w.wallet_id
                      ? "border-brand bg-brand-soft/40"
                      : "border-brand-soft/60 bg-white"
                  } ${w.self_order_blocked ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="radio"
                      name="wallet-picker"
                      checked={selectedWalletId === w.wallet_id}
                      disabled={w.self_order_blocked}
                      onChange={() => onSelectWallet(w.wallet_id)}
                      aria-label={`${w.label}, balans ${formatHTG(w.available_balance)}`}
                    />
                    <span className="truncate">{w.label}</span>
                    {w.self_order_blocked && (
                      <span className="shrink-0 text-[10px] text-destructive">
                        (ou pa ka peye pwòp restoran ou)
                      </span>
                    )}
                  </span>
                  <b className="shrink-0 tabular-nums">{formatHTG(w.available_balance)}</b>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {/* ---------- Lòt metòd yo ---------- */}
        {otherMethodsMuted && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-ink-soft">Lòt metòd</span>
            <button
              type="button"
              onClick={() => onWalletOptOut(true)}
              className="text-xs font-bold text-brand-deep underline underline-offset-2 transition hover:opacity-70 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
            >
              Peye ak yon lòt metòd
            </button>
          </div>
        )}

        <div
          className={
            otherMethodsMuted ? "grid gap-2 opacity-45 sm:grid-cols-2" : "grid gap-2 sm:grid-cols-2"
          }
        >
          {OTHER_METHODS.map((m) => {
            // `manyel` pa yon liy nan `payment_provider_settings` — li se
            // yon kouvèti sou de rezo ki la yo. Li disponib depi YOUN nan
            // de a aktif; si admin etenn toude, li disparèt menm jan ak
            // nenpòt lòt metòd. Mesaj antretyen an soti nan sa ki rete a.
            const providerOff =
              m.id === "manyel"
                ? !isProviderEnabled(providerSettings, "moncash") &&
                  !isProviderEnabled(providerSettings, "natcash")
                : !isProviderEnabled(providerSettings, m.id);
            const disabled = providerOff || otherMethodsMuted;
            const maintenanceMessage =
              m.id === "manyel"
                ? (getProviderSetting(providerSettings, "moncash")?.maintenanceMessage ??
                  getProviderSetting(providerSettings, "natcash")?.maintenanceMessage)
                : getProviderSetting(providerSettings, m.id)?.maintenanceMessage;
            const checked = !walletActive && method === m.id;
            return (
              <label
                key={m.id}
                className={`flex items-center gap-2.5 rounded-2xl border-2 p-3 text-left text-sm font-bold transition focus-within:ring-2 focus-within:ring-brand/40 ${
                  disabled
                    ? "cursor-not-allowed border-brand-soft/60 bg-cream"
                    : checked
                      ? "cursor-pointer border-brand bg-brand-soft shadow-brand-xs"
                      : "cursor-pointer border-brand-soft bg-white hover:border-brand hover:shadow-brand-xs"
                }`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  className="h-4 w-4 shrink-0 accent-brand"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onSelectMethod(m.id)}
                  aria-label={`${m.label} — ${providerOff && maintenanceMessage ? maintenanceMessage : m.sub}`}
                />
                {m.logo ? (
                  // Metòd manyèl la pote DE logo, paske li kouvri de rezo.
                  // Yo anpile ak yon ti chevoche pou yo pran menm laj ak
                  // yon sèl logo — kat yo rete menm gwosè youn ak lòt.
                  <span className="flex h-7 w-10 shrink-0 items-center">
                    <img
                      src={m.logo}
                      alt=""
                      width={40}
                      height={28}
                      loading="lazy"
                      className={`h-7 rounded-md border border-brand-soft/60 bg-white object-contain p-0.5 ${
                        "secondLogo" in m ? "w-6" : "w-10"
                      }`}
                    />
                    {"secondLogo" in m && (
                      <img
                        src={m.secondLogo}
                        alt=""
                        width={40}
                        height={28}
                        loading="lazy"
                        className="-ml-1.5 h-7 w-6 rounded-md border border-brand-soft/60 bg-white object-contain p-0.5"
                      />
                    )}
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-10 shrink-0 items-center justify-center rounded-md border border-brand-soft/60 bg-white text-brand-deep"
                  >
                    {"icon" in m && m.icon === "cash" && <Banknote className="h-4 w-4" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {m.label}
                    {providerOff && (
                      <Badge variant="secondary" className="shrink-0 font-semibold">
                        Byento disponib
                      </Badge>
                    )}
                  </span>
                  {/* Sou kat ki chwazi a, fon an se `bg-brand-soft` (#ffd5aa):
                      `text-ink-soft` bay 3.39:1 la, anba WCAG AA 4.5:1. Nou
                      fonse tèks la SÈLMAN nan ka sa a — sou blan, ink-soft
                      pase, epi li kenbe yerachi vizyèl la. */}
                  <small
                    className={`mt-0.5 block text-xs font-normal ${checked ? "text-ink" : "text-ink-soft"}`}
                  >
                    {providerOff ? maintenanceMessage : m.sub}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* ---------- Detay metòd ki chwazi a ---------- */}
      {!walletActive &&
        (method === "moncash_auto" || method === "natcash_auto" || method === "stripe") && (
          <MethodHint method={method} />
        )}
      {!walletActive && method === "manyel" && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          <p>
            Apre w konfime kòmand la, voye lajan an sou <b>youn</b> nan de nimewo sa yo, epi
            telechaje prèv peman an sou paj kòmand la. Yon administratè ap verifye epi konfime
            kòmand la.
          </p>
          {/* TOUDE nimewo yo ansanm — se tout rezon fizyon an: kliyan an
              wè kote li ka peye anvan li deside, olye li chwazi yon rezo
              alavèg epi dekouvri nimewo a apre. */}
          <ul className="mt-2.5 space-y-1.5">
            <ManualAccountRow
              logo="/moncash-logo-hero.png"
              network="MonCash"
              account={manualAccounts.moncash}
            />
            <ManualAccountRow
              logo="/natcash-logo-new.png"
              network="NatCash"
              account={manualAccounts.natcash}
            />
          </ul>
          <p className="mt-2.5">
            Sou paj kòmand la w ap di nou ki nimewo ou te sèvi — se sa ki ede administratè a jwenn
            peman w lan pi vit.
          </p>
        </div>
      )}
    </section>
  );
}

/** Yon liy « logo · rezo · nimewo (non kont) » nan blòk peman manyèl la. */
function ManualAccountRow({
  logo,
  network,
  account,
}: {
  logo: string;
  network: string;
  account: ManualAccount;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <img
        src={logo}
        alt=""
        width={40}
        height={28}
        loading="lazy"
        className="h-7 w-10 shrink-0 rounded-md border border-amber-200 bg-white object-contain p-0.5"
      />
      <span className="min-w-0">
        <b>
          {network} {account.number ?? "(pa konfigire)"}
        </b>
        {account.name ? <> ({account.name})</> : null}
      </span>
    </li>
  );
}

function MethodHint({ method }: { method: "moncash_auto" | "natcash_auto" | "stripe" }) {
  const info =
    method === "moncash_auto"
      ? { logo: "/moncash-logo-hero.png", label: "MonCash Otomatik", via: "MonCash" }
      : method === "natcash_auto"
        ? { logo: "/natcash-logo-new.png", label: "NatCash Otomatik", via: "NatCash" }
        : { logo: "/stripe-card-logo.svg", label: "Kat Kredi", via: "kat kredi ou" };
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">
      <img
        src={info.logo}
        alt=""
        width={40}
        height={28}
        loading="lazy"
        className="h-7 w-10 shrink-0 rounded-md border border-emerald-200 bg-white object-contain p-0.5"
      />
      <div>
        <b>{info.label}</b> — apre w konfime kòmand la, n ap voye w sou paj peman {info.via} la pou
        w peye dirèkteman. Kòmand la konfime otomatikman apre peman an fin fèt — pa gen prèv pou
        telechaje.
      </div>
    </div>
  );
}

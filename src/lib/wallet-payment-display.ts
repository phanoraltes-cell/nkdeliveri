/**
 * TACH 1 — lojik wallet otomatik la, bò AFICHAJ la.
 *
 * ATANSYON, LIY SA A SE LIY LAN: okenn nan fichye sa a pa yon desizyon
 * peman. Vrè desizyon an viv nan `private.create_order_secure`
 * (supabase/migrations/20260904000000_auto_wallet_payment.sql), ki
 * rekalkile total la, reli balans lan ak `SELECT ... FOR UPDATE`, epi
 * debite nan MENM tranzaksyon an ak kreyasyon kòmand la. Sa ki isit la
 * deside sèlman KISA KI PARÈT SOU EKRAN AN epi kisa nou voye nan rekèt la.
 *
 * Li nan yon modil apa (pa nan checkout.tsx) pou de rezon:
 *   1) Li se lojik pi, san React — li ka teste tout bon, ka pa ka
 *      (src/lib/__tests__/wallet-payment-display.test.ts).
 *   2) De desizyon yo (sa ki parèt / sa nou voye) dwe rete youn ak lòt:
 *      lè yo te melanje nan JSX la, li te fasil pou yon nan de a chanje
 *      pou kont li.
 */

/** Twa ka afichaj espesifikasyon an, plis eta chajman an. */
export type WalletDisplayState =
  | { kind: "loading" }
  /** Ka 3 — pa gen wallet, balans zewo, oswa admin etenn wallet: liy lan pa parèt ditou. */
  | { kind: "hidden" }
  /** Ka 1 — balans lan ase. */
  | { kind: "sufficient"; balance: number }
  /** Ka 2 — balans lan pa ase. */
  | { kind: "insufficient"; balance: number; missing: number };

export type WalletDisplayInput = {
  /** Yon vizitè ki pa konekte pa gen wallet — epi `submit()` voye l sou /auth anvan. */
  signedIn: boolean;
  /** Rekèt `get_my_payable_wallets_secure` la poko fini. */
  walletsLoading: boolean;
  /**
   * Total la final (frè livrezon ak pwomosyon restoran an fin chaje).
   * Deside sou yon total pwovizwa ta fè liy lan sote ant "ase" ak "pa ase"
   * devan je moun nan.
   */
  totalReady: boolean;
  /**
   * Total la pa ka kalkile ditou (frè livrezon an pa li). Diferan de
   * `!totalReady`, ki vle di "poko": isit la pa gen anyen k ap vini, donk
   * yon eskelèt k ap kliyanse pou tout tan ta yon manti. Nou kache liy lan
   * — pa gen desizyon wallet ki gen sans san yon total.
   */
  totalUnavailable: boolean;
  /** `payment_provider_settings.enabled` pou 'wallet' — switch admin lan. */
  walletEnabled: boolean;
  /** NULL = kliyan an pa janm gen yon wallet (ranje sentetik la). */
  walletId: string | null;
  balance: number;
  /** Wallet restoran ki pa ka peye yon kòmand nan pwòp restoran mèt li a. */
  selfOrderBlocked: boolean;
  total: number;
};

export function resolveWalletDisplayState(input: WalletDisplayInput): WalletDisplayState {
  if (!input.signedIn) return { kind: "hidden" };
  if (input.totalUnavailable) return { kind: "hidden" };
  if (input.walletsLoading || !input.totalReady) return { kind: "loading" };

  const hasFunds = !!input.walletId && input.balance > 0 && !input.selfOrderBlocked;
  if (!input.walletEnabled || !hasFunds) return { kind: "hidden" };

  if (input.balance >= input.total) return { kind: "sufficient", balance: input.balance };
  return {
    kind: "insufficient",
    balance: input.balance,
    missing: input.total - input.balance,
  };
}

/** Wallet la se metòd ki aktif la — sèl ka kote nou di sèvè a 'wallet' eksprè. */
export function isWalletActive(state: WalletDisplayState, walletOptOut: boolean): boolean {
  return state.kind === "sufficient" && !walletOptOut;
}

export type WalletSubmitDecision<M extends string> = {
  /** Sa nou voye nan `_method` — swa 'wallet', swa metòd kliyan an chwazi a. */
  method: M | "wallet";
  /** Sa nou voye nan `_allow_wallet`. */
  allowWallet: boolean;
  /** Sa nou voye nan `_wallet_id` (undefined = kite sèvè a chwazi wallet kliyan an). */
  walletId: string | undefined;
};

/**
 * Kisa pou voye nan `create_order_secure`.
 *
 * De chwa ki merite yon eksplikasyon:
 *
 *   • Lè nou kwè wallet la ase, nou di `_method: 'wallet'` EKSPRÈ. Konsa si
 *     sèvè a jwenn yon total pi wo pase pa nou an (frè livrezon ki fèk
 *     chanje), nou jwenn yon REFI PWÒP ("balans pa ase", zewo kòmand
 *     kreye) olye yon kòmand kach an silans pandan ekran an te di wallet.
 *
 *   • `allowWallet` se yon `false` SÈLMAN lè moun nan klike "Peye ak yon
 *     lòt metòd". Nan tout lòt ka li rete `true`, sa ki kite sèvè a fòse
 *     wallet la si balans lan ase nan reyalite pa l — se sa ki fè yon
 *     rekèt modifye nan navigatè a pa chanje desizyon an.
 */
export function decideWalletSubmit<M extends string>(params: {
  state: WalletDisplayState;
  walletOptOut: boolean;
  /** Metòd ki chwazi nan lis "lòt metòd" yo, deja tradui nan ray backend la. */
  fallbackMethod: M;
  selectedWalletId: string | null;
}): WalletSubmitDecision<M> {
  const active = isWalletActive(params.state, params.walletOptOut);
  return {
    method: active ? "wallet" : params.fallbackMethod,
    allowWallet: !params.walletOptOut,
    // Nou voye wallet la sèlman lè liy lan reyèlman vizib: san sa yon
    // wallet restoran/livrè ta ka debite otomatikman pou yon kòmand
    // pèsonèl san moun nan pa t janm wè l sou ekran an.
    walletId:
      params.state.kind !== "hidden" && !params.walletOptOut
        ? (params.selectedWalletId ?? undefined)
        : undefined,
  };
}

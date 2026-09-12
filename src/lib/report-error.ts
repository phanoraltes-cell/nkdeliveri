/**
 * SIYALE YON ERÈ KI PA KRAZE PAJ LA.
 *
 * Lè yon paj piblik degrade olye li kraze, nou twoke yon aksidan ki fè bri
 * kont yon pàn bèbè. Sa a se dezyèm mwatye kontra a: degradasyon an dwe
 * VIZIB pou nou, menm lè li envizib pou moun k ap gade paj la.
 *
 * `console.error` pou kont li pa ase: sou Vercel li ale nan log fonksyon
 * yo, kote pèsonn pa li yo.
 *
 * De pwi paske chajè yo kouri toude bò:
 *
 *   * SSR (`typeof window === "undefined"`) — se la ka ki pi grav la ye,
 *     paske se rezilta sa a Googlebot wè.
 *   * Navigatè a — lè react-query refè demann lan apre idratasyon.
 *
 * Chajman an parese eksprè (menm modèl ak `__root.tsx`, `rpc-errors.ts` ak
 * `money.ts`): Sentry pa dwe janm bloke afichaj yon paj, epi gad
 * `initialized` chak modil la fè apèl repete yo bon mache.
 */
export function reportDegradation(message: string, cause: unknown): void {
  const error = new Error(message, { cause });
  console.error(error);

  // Sentry pa obligatwa pou paj la mache — konsòl la deja gen tras la.
  const sink =
    typeof window === "undefined"
      ? import("@/lib/sentry.server").then((m) => m.captureExceptionServer(error))
      : import("@/lib/sentry-browser").then((m) => m.captureExceptionClient(error));
  void sink.catch(() => {});
}

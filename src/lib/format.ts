export function formatHTG(amount: number): string {
  return `${amount.toLocaleString("fr-HT", { maximumFractionDigits: 0 })} HTG`;
}

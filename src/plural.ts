/** Bosnian forms after a number: 1 dio, 2–4 dijela, 5+ dijelova (11–14 take the last form). */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

export const parts = (n: number) => plural(n, 'dio', 'dijela', 'dijelova');
export const pagesWord = (n: number) => plural(n, 'strana', 'strane', 'strana');
export const notesWord = (n: number) => plural(n, 'fusnota', 'fusnote', 'fusnota');

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function monthName(monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return MONTH_NAMES[month - 1] ?? monthKey;
}

function joinMonths(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function observedHabitBasisLabel(monthKeys: string[]) {
  return `Baseado em ${joinMonths(monthKeys.map(monthName))}`;
}

export function observedHabitOutlierLabel(discarded: boolean) {
  return discarded ? "Um mês atípico foi desconsiderado." : null;
}

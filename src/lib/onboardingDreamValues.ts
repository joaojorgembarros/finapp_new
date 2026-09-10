import { parseBRLToCents } from "./format";

export function hasAllPositiveDreamValues(
  dreams: string[],
  values: Record<string, string>
) {
  return dreams.length > 0
    && dreams.every((dream) => parseBRLToCents(values[dream] ?? "") > 0);
}

/** The ids of the two images side by side, in the order they were picked. */
export type ComparePair = readonly [string, string];

/**
 * What a comparison starts with: the image on screen and the one taken just
 * before it, or just after it when it is the oldest. Null with fewer than two.
 */
export function initialComparePair(
  updates: ReadonlyArray<{ readonly id: string }>,
  selectedId: string | undefined,
): ComparePair | null {
  if (updates.length < 2) return null;
  const found = updates.findIndex((update) => update.id === selectedId);
  // Oldest first, so the one before is the previous capture.
  const index = found === -1 ? updates.length - 1 : found;
  const other = index > 0 ? index - 1 : index + 1;
  return [updates[other]!.id, updates[index]!.id];
}

/** Picking an image replaces the one picked longer ago; picking one already shown changes nothing. */
export function pickForComparison(pair: ComparePair, picked: string): ComparePair {
  return pair.includes(picked) ? pair : [pair[1], picked];
}

/** The pair's images, earlier first, so the comparison reads in time order. */
export function comparedUpdates<Update extends { readonly id: string; readonly createdAt: string }>(
  updates: ReadonlyArray<Update>,
  pair: ComparePair,
): readonly [Update, Update] | null {
  const first = updates.find((update) => update.id === pair[0]);
  const second = updates.find((update) => update.id === pair[1]);
  if (first === undefined || second === undefined) return null;
  return Date.parse(first.createdAt) <= Date.parse(second.createdAt)
    ? [first, second]
    : [second, first];
}

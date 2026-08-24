export function isCurrentPanelOperation({
  mounted,
  operationSequence,
  latestSequence,
}: {
  mounted: boolean;
  operationSequence: number;
  latestSequence: number;
}): boolean {
  return mounted && operationSequence === latestSequence;
}

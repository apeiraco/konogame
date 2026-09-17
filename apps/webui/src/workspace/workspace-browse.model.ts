/** Level of a tree node value: starting points are 1, their children 2, and so on. */
export function treeLevel(value: string, separator: string) {
  return value.split(separator).length - 1;
}

/**
 * Visual indent steps for a node. The anchor's parent and everything below it indent one step per
 * level; older ancestors share the parent's column so deep paths do not drift right.
 */
export function indentDepth(level: number, anchorLevel: number) {
  return Math.max(0, level - Math.max(1, anchorLevel - 1));
}

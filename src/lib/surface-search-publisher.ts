import type {
  SurfaceSearchIndexGroup,
  SurfaceSearchIndexUpdate,
} from "../types";

export interface PublishableSurfaceSearchGroup extends SurfaceSearchIndexGroup {
  signature: string;
}

export type SurfaceSearchGroupSnapshot = ReadonlyMap<
  string,
  PublishableSurfaceSearchGroup
>;

export function createSurfaceSearchPublisher(
  publisherId: string,
  send: (update: SurfaceSearchIndexUpdate) => Promise<void>,
) {
  let revision = 0;
  let acknowledged = new Map<string, string>();
  let resetRequired = true;
  let queue = Promise.resolve();

  function publish(desired: SurfaceSearchGroupSnapshot): Promise<number> {
    const snapshot = new Map(
      [...desired].map(([id, group]) => [
        id,
        { ...group, rows: group.rows.slice() },
      ]),
    );
    const operation = queue.then(async () => {
      const reset = resetRequired;
      const replace = [...snapshot].flatMap(([id, group]) =>
        reset || acknowledged.get(id) !== group.signature
          ? [{ id, league: group.league, fetchedAt: group.fetchedAt, rows: group.rows }]
          : [],
      );
      const remove = reset
        ? []
        : [...acknowledged.keys()].filter((id) => !snapshot.has(id));
      if (!reset && !replace.length && !remove.length) return revision;

      const nextRevision = revision + 1;
      revision = nextRevision;
      try {
        await send({
          publisherId,
          revision: nextRevision,
          reset,
          replace,
          remove,
        });
      } catch (error) {
        resetRequired = true;
        throw error;
      }
      acknowledged = new Map(
        [...snapshot].map(([id, group]) => [id, group.signature]),
      );
      resetRequired = false;
      return nextRevision;
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return Object.freeze({ publish });
}

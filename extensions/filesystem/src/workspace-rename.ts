import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  RecordKind,
  type RenameConfigurationInput,
  type RenameConfigurationResult,
  RenameStatus,
  recordFileKey,
  recordSchema,
  uuidSchema
} from "@konogame/workspace";
import { v7 as uuidv7 } from "uuid";
import { parseConfigurationToml, replaceUniformName } from "./toml.ts";
import { digest, directory, exists, loadConfigurationState } from "./workspace.ts";

interface Recovery {
  version: 1;
  recordId: string;
  uniformName: string;
  operationId: string;
  expectedRevision: string;
  before: string;
  after: string;
  from: string;
  to: string;
  temporary: string;
  moves: { from: string; to: string; via: string }[];
  beforeDocuments: { path: string; hash: string }[];
}

async function readRecovery(root: string, path: string): Promise<Recovery> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024)
    throw new Error("Invalid rename recovery journal");
  const journal = JSON.parse(await readFile(path, "utf8")) as Recovery;
  if (
    journal.version !== 1 ||
    !Array.isArray(journal.moves) ||
    !Array.isArray(journal.beforeDocuments)
  )
    throw new Error("Invalid rename recovery journal");
  const paths = [
    journal.from,
    journal.to,
    journal.temporary,
    ...journal.moves.flatMap((move) => [move.from, move.to, move.via]),
    ...journal.beforeDocuments.map((entry) => entry.path)
  ];
  for (const item of paths) {
    if (
      typeof item !== "string" ||
      item.includes("\\") ||
      item.startsWith("/") ||
      item.includes(":") ||
      item.split("/").some((part) => !part || part === ".." || part === ".")
    )
      throw new Error("Unsafe rename recovery path");
    let parent = dirname(join(root, item));
    while (parent !== root) {
      if (await exists(parent)) await directory(parent);
      parent = dirname(parent);
    }
  }
  const before = recordSchema.parse(parseConfigurationToml(journal.before).data);
  const after = recordSchema.parse(parseConfigurationToml(journal.after).data);
  if (
    before.id !== journal.recordId ||
    after.id !== journal.recordId ||
    after.kind === RecordKind.Workspace ||
    after.uniformName !== journal.uniformName ||
    (journal.before !== journal.after &&
      replaceUniformName(journal.before, journal.uniformName) !== journal.after)
  )
    throw new Error("Invalid rename recovery content");
  return journal;
}

async function sameFile(left: string, right: string): Promise<boolean> {
  if (!(await exists(left)) || !(await exists(right))) return false;
  const a = await lstat(left);
  const b = await lstat(right);
  return a.dev === b.dev && a.ino === b.ino;
}

async function stagedFile(path: string, content: string): Promise<void> {
  if (await exists(path)) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (await readFile(path, "utf8")) !== content)
      throw new Error("Rename staging file changed externally");
    return;
  }
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function cleanStagedFile(path: string, content: string): Promise<void> {
  if (!(await exists(path))) return;
  await stagedFile(path, content);
  await unlink(path);
}

async function finish(
  root: string,
  recoveryPath: string,
  journal: Recovery,
  inputRoot: string,
  operationId: string
): Promise<RenameConfigurationResult> {
  const output = (status: RenameStatus, reason?: string): RenameConfigurationResult => ({
    status,
    operationId,
    paths: journal.moves,
    ...(reason ? { reason } : {})
  });
  const mapped = (path: string) => {
    for (const move of journal.moves)
      if (path === move.from || path.startsWith(`${move.from}/`))
        return move.to + path.slice(move.from.length);
    return path;
  };
  const currentPath = async (path: string): Promise<string> => {
    const candidates = [path, mapped(path)];
    for (const move of journal.moves)
      if (path === move.from || path.startsWith(`${move.from}/`))
        candidates.push(move.via + path.slice(move.from.length));
    for (const candidate of candidates) if (await exists(join(root, candidate))) return candidate;
    throw new Error(`Rename record is missing: ${path}`);
  };
  try {
    // Both pre-move and post-move hashes are accepted to resume a crashed rename.
    for (const entry of journal.beforeDocuments) {
      const path = await currentPath(entry.path);
      const info = await lstat(join(root, path));
      if (!info.isFile() || info.isSymbolicLink())
        return output(RenameStatus.RecoveryRequired, `Record changed externally: ${path}`);
      const content = await readFile(join(root, path), "utf8");
      if (
        digest(content) !== entry.hash &&
        !(entry.path === journal.from && content === journal.after)
      )
        return output(RenameStatus.RecoveryRequired, `Record changed externally: ${path}`);
    }
    for (const move of journal.moves) {
      const from = await exists(join(root, move.from));
      const to = await exists(join(root, move.to));
      const via = await exists(join(root, move.via));
      const aliases = from && to && (await sameFile(join(root, move.from), join(root, move.to)));
      if ((from && to && !aliases) || (via && (from || to)))
        return output(RenameStatus.RecoveryRequired, `Multiple rename paths exist: ${move.to}`);
      if (!from && !to && !via)
        return output(RenameStatus.RecoveryRequired, `Rename paths are missing: ${move.from}`);
      if (from) {
        // The intermediate path also makes case-only moves reliable on Windows.
        await rename(join(root, move.from), join(root, move.via));
        await rename(join(root, move.via), join(root, move.to));
      } else if (via) await rename(join(root, move.via), join(root, move.to));
    }
    const current = await readFile(join(root, journal.to), "utf8");
    if (current !== journal.before && current !== journal.after)
      return output(RenameStatus.RecoveryRequired, "Record changed externally before replacement");
    if (current !== journal.after) {
      await stagedFile(join(root, journal.temporary), journal.after);
      if ((await readFile(join(root, journal.to), "utf8")) !== journal.before)
        return output(
          RenameStatus.RecoveryRequired,
          "Record changed externally before replacement"
        );
      await rename(join(root, journal.temporary), join(root, journal.to));
    }
    const state = await loadConfigurationState(inputRoot);
    const expected = journal.beforeDocuments.map((entry) => ({
      path: mapped(entry.path),
      hash: entry.path === journal.from ? digest(journal.after) : entry.hash
    }));
    if (
      state.documents.length !== expected.length ||
      state.documents.some(
        (entry) => expected.find((item) => item.path === entry.path)?.hash !== digest(entry.content)
      )
    )
      return output(RenameStatus.RecoveryRequired, "Workspace changed externally during rename");
    await cleanStagedFile(join(root, `${journal.temporary}.rollback`), journal.before);
    await unlink(recoveryPath);
    return { ...output(RenameStatus.Renamed), revision: state.snapshot.revision };
  } catch (error) {
    // Roll back only paths whose original bytes still match; never replace external work.
    try {
      for (const entry of journal.beforeDocuments) {
        const content = await readFile(join(root, await currentPath(entry.path)), "utf8");
        if (
          digest(content) !== entry.hash &&
          !(entry.path === journal.from && content === journal.after)
        )
          return output(RenameStatus.RecoveryRequired, String(error));
      }
      const contentPath = await currentPath(journal.from);
      if ((await readFile(join(root, contentPath), "utf8")) === journal.after) {
        const rollback = `${journal.temporary}.rollback`;
        await stagedFile(join(root, rollback), journal.before);
        if ((await readFile(join(root, contentPath), "utf8")) !== journal.after)
          return output(RenameStatus.RecoveryRequired, "Record changed externally during rollback");
        await rename(join(root, rollback), join(root, contentPath));
      }
      for (const move of [...journal.moves].reverse()) {
        const current = (await exists(join(root, move.via)))
          ? move.via
          : (await exists(join(root, move.to)))
            ? move.to
            : move.from;
        if (current !== move.from) {
          if (
            (await exists(join(root, move.from))) &&
            !(await sameFile(join(root, current), join(root, move.from)))
          )
            return output(RenameStatus.RecoveryRequired, "Rollback destination changed externally");
          if (current !== move.via) await rename(join(root, current), join(root, move.via));
          await rename(join(root, move.via), join(root, move.from));
        }
      }
      await cleanStagedFile(join(root, journal.temporary), journal.after);
      await cleanStagedFile(join(root, `${journal.temporary}.rollback`), journal.before);
      await unlink(recoveryPath);
      return output(RenameStatus.Failed, String(error));
    } catch {
      return output(RenameStatus.RecoveryRequired, String(error));
    }
  }
}

export async function renameConfiguration(
  input: RenameConfigurationInput
): Promise<RenameConfigurationResult> {
  const result = (
    status: RenameStatus,
    reason?: string,
    extra: Partial<RenameConfigurationResult> = {}
  ): RenameConfigurationResult => ({
    status,
    operationId: input.operationId,
    ...(reason ? { reason } : {}),
    ...extra
  });
  let root: string;
  try {
    uuidSchema.parse(input.recordId);
    uuidSchema.parse(input.operationId);
    recordFileKey(input.recordId, input.uniformName);
    root = join(await realpath(input.root), ".konogame");
    await directory(root);
  } catch (error) {
    return result(RenameStatus.Failed, String(error));
  }
  try {
    for (const folder of ["recovery", "recovery/rename"]) {
      const path = join(root, folder);
      if (!(await exists(path))) {
        try {
          await mkdir(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      await directory(path);
    }
  } catch (error) {
    return result(RenameStatus.RecoveryRequired, String(error));
  }
  const lockPath = join(root, "recovery/rename/writer.lock");
  const recoveryPath = join(root, "recovery/rename/journal.json");
  const token = uuidv7();
  let lockOwned = false;
  try {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      lockOwned = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await lstat(lockPath);
      if (!info.isFile() || info.isSymbolicLink())
        return result(RenameStatus.RecoveryRequired, "Invalid Workspace writer lock");
      const prior = await readFile(lockPath, "utf8");
      const lock = JSON.parse(prior) as { pid: number };
      if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0)
        return result(RenameStatus.RecoveryRequired, "Invalid Workspace writer lock owner");
      let alive = true;
      try {
        process.kill(lock.pid, 0);
      } catch (failure) {
        alive = (failure as NodeJS.ErrnoException).code !== "ESRCH";
      }
      if (alive) return result(RenameStatus.Conflict, "Workspace writer lock is held");
      if ((await readFile(lockPath, "utf8")) !== prior)
        return result(RenameStatus.Conflict, "Workspace writer lock changed");
      await unlink(lockPath);
      return await renameConfiguration(input);
    }
    if (await exists(recoveryPath)) {
      const journal = await readRecovery(root, recoveryPath);
      if (journal.recordId !== input.recordId || journal.uniformName !== input.uniformName)
        return result(RenameStatus.RecoveryRequired, "Another rename requires recovery");
      return await finish(root, recoveryPath, journal, input.root, input.operationId);
    }
    const state = await loadConfigurationState(input.root);
    if (state.snapshot.revision !== input.expectedRevision)
      return result(RenameStatus.Conflict, "Workspace revision changed", {
        revision: state.snapshot.revision
      });
    const document = state.documents.find((item) => item.record.id === input.recordId);
    if (!document || document.record.kind === RecordKind.Workspace)
      return result(RenameStatus.Failed, "Rename requires a Game, Host or Installation record");
    const flat = basename(document.path) !== `${document.record.kind}.toml`;
    const key = recordFileKey(document.record.id, input.uniformName, flat ? ".toml" : "");
    const moves: Recovery["moves"] = [];
    const oldContainer = document.container!;
    const newContainer = `${dirname(oldContainer).replaceAll("\\", "/")}/${flat ? key.slice(0, -5) : key}`;
    const to = flat
      ? `${dirname(document.path).replaceAll("\\", "/")}/${key}`
      : `${newContainer}/${document.record.kind}.toml`;
    if (flat && document.path !== to)
      moves.push({ from: document.path, to, via: `recovery/rename/${token}-record` });
    if (
      oldContainer !== newContainer &&
      (!flat ||
        (document.record.kind === RecordKind.Host && (await exists(join(root, oldContainer)))))
    )
      moves.push({
        from: oldContainer,
        to: newContainer,
        via: `recovery/rename/${token}-container`
      });
    for (const move of moves)
      if (
        (await exists(join(root, move.to))) &&
        !(await sameFile(join(root, move.from), join(root, move.to)))
      )
        return result(RenameStatus.Conflict, `Rename destination exists: ${move.to}`);
    if (document.record.uniformName === input.uniformName && moves.length === 0)
      return result(RenameStatus.Unchanged, undefined, { revision: state.snapshot.revision });
    const after =
      document.record.uniformName === input.uniformName
        ? document.content
        : replaceUniformName(document.content, input.uniformName);
    recordSchema.parse(parseConfigurationToml(after).data);
    const journal: Recovery = {
      version: 1,
      recordId: input.recordId,
      uniformName: input.uniformName,
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
      before: document.content,
      after,
      from: document.path,
      to,
      temporary: `recovery/rename/${token}.tmp`,
      moves,
      beforeDocuments: state.documents.map(({ path, content }) => ({ path, hash: digest(content) }))
    };
    if ((await loadConfigurationState(input.root)).snapshot.revision !== input.expectedRevision)
      return result(RenameStatus.Conflict, "Workspace revision changed before rename");
    const journalHandle = await open(recoveryPath, "wx");
    try {
      await journalHandle.writeFile(JSON.stringify(journal));
      await journalHandle.sync();
    } finally {
      await journalHandle.close();
    }
    return await finish(root, recoveryPath, journal, input.root, input.operationId);
  } catch (error) {
    return result(
      (await exists(recoveryPath)) ? RenameStatus.RecoveryRequired : RenameStatus.Failed,
      String(error)
    );
  } finally {
    if (lockOwned) {
      try {
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as { token: string };
        if (lock.token === token) await unlink(lockPath);
      } catch {
        /* A missing lock must not overwrite the operation result. */
      }
    }
  }
}

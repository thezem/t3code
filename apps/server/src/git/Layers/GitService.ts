/**
 * Git process helpers - Effect-native git execution with typed errors.
 *
 * Centralizes child-process git invocation for server modules. This module
 * only executes git commands and reports structured failures.
 *
 * @module GitServiceLive
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

import { Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { GitCommandError } from "../Errors.ts";
import {
  type ExecuteGitInput,
  type ExecuteGitProgress,
  type ExecuteGitResult,
  GitService,
  type GitServiceShape,
} from "../Services/GitService.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const Trace2ChunkSchema = Schema.Record(Schema.String, Schema.Unknown);
const decodeTrace2Chunk = Schema.decodeEffect(Schema.fromJsonString(Trace2ChunkSchema));

function quoteGitCommand(args: ReadonlyArray<string>): string {
  return `git ${args.join(" ")}`;
}

function toGitCommandError(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  detail: string,
) {
  return (cause: unknown) =>
    Schema.is(GitCommandError)(cause)
      ? cause
      : new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${cause instanceof Error && cause.message.length > 0 ? cause.message : "Unknown error"} - ${detail}`,
          ...(cause !== undefined ? { cause } : {}),
        });
}

function trace2ChildKey(record: Record<string, unknown>): string | null {
  const childId = record.child_id;
  if (typeof childId === "number" || typeof childId === "string") {
    return String(childId);
  }
  const hookName = record.hook_name;
  return typeof hookName === "string" && hookName.trim().length > 0 ? hookName.trim() : null;
}

const createTrace2Monitor = Effect.fn(function* (
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  progress: ExecuteGitProgress | undefined,
) {
  if (!progress?.onHookStarted && !progress?.onHookFinished) {
    return {
      env: {},
      flush: Effect.void,
    };
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const traceDir = tmpdir();
  const traceFileName = `t3code-git-trace2-${process.pid}-${randomUUID()}.json`;
  const traceFilePath = path.join(traceDir, traceFileName);
  const hookStartByChildKey = new Map<string, { hookName: string; startedAtMs: number }>();
  let processedChars = 0;
  let lineBuffer = "";

  const handleTraceLine = (line: string) =>
    Effect.gen(function* () {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) {
        return;
      }

      const decodedRecord = yield* Effect.exit(decodeTrace2Chunk(trimmedLine));
      if (decodedRecord._tag === "Failure") {
        yield* Effect.logDebug(
          `GitService.trace2: failed to parse trace line for ${quoteGitCommand(input.args)} in ${input.cwd}.`,
        );
        return;
      }
      const record = decodedRecord.value;
      if (Object.keys(record).length === 0) {
        yield* Effect.logDebug(
          `GitService.trace2: failed to parse trace line for ${quoteGitCommand(input.args)} in ${input.cwd}: Trace line was not an object.`,
        );
        return;
      }

      if (record.child_class !== "hook") {
        return;
      }

      const event = record.event;
      const childKey = trace2ChildKey(record);
      if (childKey === null) {
        return;
      }
      const started = hookStartByChildKey.get(childKey);
      const hookNameFromEvent = typeof record.hook_name === "string" ? record.hook_name.trim() : "";
      const hookName = hookNameFromEvent.length > 0 ? hookNameFromEvent : (started?.hookName ?? "");
      if (hookName.length === 0) {
        return;
      }

      if (event === "child_start") {
        hookStartByChildKey.set(childKey, { hookName, startedAtMs: Date.now() });
        if (progress.onHookStarted) {
          yield* progress.onHookStarted(hookName);
        }
        return;
      }

      if (event === "child_exit") {
        hookStartByChildKey.delete(childKey);
        if (progress.onHookFinished) {
          const code = record.code;
          yield* progress.onHookFinished({
            hookName: started?.hookName ?? hookName,
            exitCode: typeof code === "number" && Number.isInteger(code) ? code : null,
            durationMs: started ? Math.max(0, Date.now() - started.startedAtMs) : null,
          });
        }
      }
    });

  const readTraceDelta = fileSystem.readFileString(traceFilePath).pipe(
    Effect.catch(() => Effect.succeed("")),
    Effect.flatMap((delta) =>
      Effect.gen(function* () {
        if (delta.length <= processedChars) {
          return;
        }
        const appended = delta.slice(processedChars);
        processedChars = delta.length;
        lineBuffer += appended;
        let newlineIndex = lineBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = lineBuffer.slice(0, newlineIndex);
          lineBuffer = lineBuffer.slice(newlineIndex + 1);
          yield* handleTraceLine(line);
          newlineIndex = lineBuffer.indexOf("\n");
        }
      }),
    ),
  );
  const watchTraceFile = Stream.runForEach(fileSystem.watch(traceDir), (event) => {
    const eventPath = event.path;
    const isTargetTraceEvent =
      eventPath === traceFileName ||
      eventPath === traceFilePath ||
      path.resolve(traceDir, eventPath) === traceFilePath;
    if (!isTargetTraceEvent) {
      return Effect.void;
    }
    return readTraceDelta;
  }).pipe(Effect.ignoreCause({ log: true }));

  yield* Effect.forkScoped(watchTraceFile);

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* readTraceDelta;
      const finalLine = lineBuffer.trim();
      if (finalLine.length > 0) {
        yield* handleTraceLine(finalLine);
      }
      yield* fileSystem.remove(traceFilePath).pipe(Effect.catch(() => Effect.void));
    }),
  );

  return {
    env: {
      GIT_TRACE2_EVENT: traceFilePath,
    },
    flush: readTraceDelta,
  };
});

const collectOutput = Effect.fn(function* <E>(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  stream: Stream.Stream<Uint8Array, E>,
  maxOutputBytes: number,
  onLine: ((line: string) => Effect.Effect<void, never>) | undefined,
): Effect.fn.Return<string, GitCommandError> {
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  let lineBuffer = "";

  const emitCompleteLines = (flush: boolean) =>
    Effect.gen(function* () {
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (line.length > 0 && onLine) {
          yield* onLine(line);
        }
        newlineIndex = lineBuffer.indexOf("\n");
      }

      if (flush) {
        const trailing = lineBuffer.replace(/\r$/, "");
        lineBuffer = "";
        if (trailing.length > 0 && onLine) {
          yield* onLine(trailing);
        }
      }
    });

  yield* Stream.runForEach(stream, (chunk) =>
    Effect.gen(function* () {
      bytes += chunk.byteLength;
      if (bytes > maxOutputBytes) {
        return yield* new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${quoteGitCommand(input.args)} output exceeded ${maxOutputBytes} bytes and was truncated.`,
        });
      }
      const decoded = decoder.decode(chunk, { stream: true });
      text += decoded;
      lineBuffer += decoded;
      yield* emitCompleteLines(false);
    }),
  ).pipe(Effect.mapError(toGitCommandError(input, "output stream failed.")));

  const remainder = decoder.decode();
  text += remainder;
  lineBuffer += remainder;
  yield* emitCompleteLines(true);
  return text;
});

const makeGitService = Effect.gen(function* () {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const execute: GitServiceShape["execute"] = Effect.fnUntraced(function* (input) {
    const commandInput = {
      ...input,
      args: [...input.args],
    } as const;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    const commandEffect = Effect.gen(function* () {
      const trace2Monitor = yield* createTrace2Monitor(commandInput, input.progress).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      const child = yield* commandSpawner
        .spawn(
          ChildProcess.make("git", commandInput.args, {
            cwd: commandInput.cwd,
            env: {
              ...process.env,
              ...input.env,
              ...trace2Monitor.env,
            },
          }),
        )
        .pipe(Effect.mapError(toGitCommandError(commandInput, "failed to spawn.")));

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectOutput(commandInput, child.stdout, maxOutputBytes, input.progress?.onStdoutLine),
          collectOutput(commandInput, child.stderr, maxOutputBytes, input.progress?.onStderrLine),
          child.exitCode.pipe(
            Effect.map((value) => Number(value)),
            Effect.mapError(toGitCommandError(commandInput, "failed to report exit code.")),
          ),
        ],
        { concurrency: "unbounded" },
      );
      yield* trace2Monitor.flush;

      if (!input.allowNonZeroExit && exitCode !== 0) {
        const trimmedStderr = stderr.trim();
        return yield* new GitCommandError({
          operation: commandInput.operation,
          command: quoteGitCommand(commandInput.args),
          cwd: commandInput.cwd,
          detail:
            trimmedStderr.length > 0
              ? `${quoteGitCommand(commandInput.args)} failed: ${trimmedStderr}`
              : `${quoteGitCommand(commandInput.args)} failed with code ${exitCode}.`,
        });
      }

      return { code: exitCode, stdout, stderr } satisfies ExecuteGitResult;
    });

    return yield* commandEffect.pipe(
      Effect.scoped,
      Effect.timeoutOption(timeoutMs),
      Effect.flatMap((result) =>
        Option.match(result, {
          onNone: () =>
            Effect.fail(
              new GitCommandError({
                operation: commandInput.operation,
                command: quoteGitCommand(commandInput.args),
                cwd: commandInput.cwd,
                detail: `${quoteGitCommand(commandInput.args)} timed out.`,
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
  });

  return {
    execute,
  } satisfies GitServiceShape;
});

export const GitServiceLive = Layer.effect(GitService, makeGitService);

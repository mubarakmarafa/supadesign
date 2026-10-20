import {
  type BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  type ProjectBoard,
  ProjectBoardError,
  type ProjectId,
  type ThreadBoardPlacement,
  type ThreadId,
} from "@supaterm/contracts";
import {
  findBoardCardColumn,
  newBoardCardIndex,
  planBoardCardMove,
  resolveBoardColumns,
} from "@supaterm/shared/projectBoard";
import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

/** A project thread as the board sees it. */
export interface BoardThreadRecord {
  readonly id: ThreadId;
  readonly title: string;
  readonly createdAt: DateTime.Utc;
  readonly archivedAt: DateTime.Utc | null;
  readonly board: ThreadBoardPlacement | null;
  /** A turn is preparing, starting, or running, so the thread can't be archived. */
  readonly working: boolean;
}

/** Where the board's state lives and how a move reaches the rest of the server. */
export interface ProjectBoardOps {
  readonly readProject: (projectId: ProjectId) => Effect.Effect<
    {
      readonly board: ProjectBoard | null;
      /** Every thread of the project, archived ones included, without subagents. */
      readonly threads: ReadonlyArray<BoardThreadRecord>;
      /** The thread the board agent chats in, which is not a card. */
      readonly boardAgentThreadId: ThreadId | null;
    },
    ProjectBoardError
  >;
  readonly projectOf: (threadId: ThreadId) => Effect.Effect<ProjectId, ProjectBoardError>;
  readonly place: (input: {
    readonly threadId: ThreadId;
    readonly columnId: BoardColumnId;
    readonly orderKey: string;
    readonly returnColumnId: BoardColumnId | null;
  }) => Effect.Effect<void, ProjectBoardError>;
  readonly setArchived: (
    threadId: ThreadId,
    archived: boolean,
  ) => Effect.Effect<void, ProjectBoardError>;
  /** Sends the card's banked messages; a card with none is left alone. */
  readonly sendBank: (threadId: ThreadId) => Effect.Effect<void, ProjectBoardError>;
  /** Stops the card's live environment, if it has one, without a warm period. */
  readonly stopLiveEnvironment: (threadId: ThreadId) => Effect.Effect<void>;
}

export interface ProjectBoardCardView {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly archived: boolean;
}

export interface ProjectBoardColumnView {
  readonly id: BoardColumnId;
  readonly title: string;
  /** New and unplaced cards land here. */
  readonly inbox: boolean;
  /** The top card here is the one whose dev server runs. */
  readonly live: boolean;
  /** Moving a card here sends its banked messages. */
  readonly send: boolean;
  /** Moving a card here archives it. */
  readonly done: boolean;
  /** Names of the prompts sent when a card moves in. */
  readonly onEnter: ReadonlyArray<string>;
  /** Names of the prompts sent when a card moves out. */
  readonly onLeave: ReadonlyArray<string>;
  readonly cardCount: number;
  /** Top to bottom, at most `limit` of them. */
  readonly cards: ReadonlyArray<ProjectBoardCardView>;
}

export interface ProjectBoardPlacementResult {
  readonly columnId: BoardColumnId;
  /** Position in the column, from the top. */
  readonly index: number;
}

export class ProjectBoardService extends Context.Service<
  ProjectBoardService,
  {
    /** The project's columns and their cards, top to bottom. */
    readonly read: (input: {
      readonly projectId: ProjectId;
      readonly limit?: number | undefined;
    }) => Effect.Effect<ReadonlyArray<ProjectBoardColumnView>, ProjectBoardError>;
    /**
     * Moves a card the way a drag does: into Done archives it, out of Done
     * unarchives it, into the send column sends its banked messages, and out
     * of the live column stops its dev server. `index` is counted without the
     * card itself and defaults to the top.
     */
    readonly moveCard: (input: {
      readonly threadId: ThreadId;
      readonly columnId: BoardColumnId;
      readonly index?: number | undefined;
    }) => Effect.Effect<ProjectBoardPlacementResult, ProjectBoardError>;
    /**
     * Puts a card that was just made where the board's "+" would: the top of
     * `columnId` (the inbox when omitted), or under the live card in the live column.
     */
    readonly placeNewCard: (input: {
      readonly threadId: ThreadId;
      readonly columnId?: BoardColumnId | undefined;
    }) => Effect.Effect<ProjectBoardPlacementResult, ProjectBoardError>;
  }
>()("supaterm/projectBoard/ProjectBoardService") {}

const fail = (message: string) => new ProjectBoardError({ message });

const DEFAULT_READ_LIMIT = 50;

export const make = (ops: ProjectBoardOps) =>
  Effect.gen(function* () {
    // Moves are planned from the board as it stands, so one runs at a time.
    const moves = yield* Semaphore.make(1);

    const load = (projectId: ProjectId) =>
      Effect.map(ops.readProject(projectId), ({ board, threads: all, boardAgentThreadId }) => {
        const threads = all.filter((thread) => thread.id !== boardAgentThreadId);
        return {
          board,
          threads,
          boardAgentThreadId,
          layout: board ?? DEFAULT_PROJECT_BOARD,
          resolved: resolveBoardColumns(board, threads),
        };
      });

    const read: ProjectBoardService["Service"]["read"] = ({ projectId, limit }) =>
      Effect.map(load(projectId), ({ layout, resolved }) =>
        resolved.map(({ column, cards }) => ({
          id: column.id,
          title: column.title,
          inbox: column.id === layout.inboxColumnId,
          live: column.id === layout.liveColumnId,
          send: column.id === layout.sendColumnId,
          done: column.id === layout.doneColumnId,
          onEnter: (column.onEnter ?? []).map((step) => step.name),
          onLeave: (column.onLeave ?? []).map((step) => step.name),
          cardCount: cards.length,
          cards: cards.slice(0, limit ?? DEFAULT_READ_LIMIT).map(({ thread }) => ({
            threadId: thread.id,
            title: thread.title,
            archived: thread.archivedAt !== null,
          })),
        })),
      );

    const move = (input: {
      readonly threadId: ThreadId;
      readonly columnId: BoardColumnId | undefined;
      readonly index: (board: ProjectBoard, columnId: BoardColumnId, count: number) => number;
    }) =>
      Effect.gen(function* () {
        const projectId = yield* ops.projectOf(input.threadId);
        const { board, threads, boardAgentThreadId, layout, resolved } = yield* load(projectId);
        if (input.threadId === boardAgentThreadId) {
          return yield* fail(
            "That thread is the board agent, not a card. Pass the threadId of the card to move.",
          );
        }
        const thread = threads.find((entry) => entry.id === input.threadId);
        if (thread === undefined) return yield* fail("The card's thread is not on this board.");
        const toColumnId = input.columnId ?? layout.inboxColumnId;
        const target = resolved.find((entry) => entry.column.id === toColumnId);
        if (target === undefined) {
          const known = layout.columns.map((column) => `${column.id} (${column.title})`);
          return yield* fail(`There is no column ${toColumnId}. Columns: ${known.join(", ")}.`);
        }
        const archived = thread.archivedAt !== null;
        if (toColumnId === layout.doneColumnId && !archived && thread.working) {
          return yield* fail("The card is still working. Stop its turn before moving it to Done.");
        }
        const fromColumnId = findBoardCardColumn(resolved, thread.id) ?? layout.inboxColumnId;
        const others = target.cards.filter((card) => card.thread.id !== thread.id).length;
        const index = Math.max(
          0,
          Math.min(Math.trunc(input.index(layout, toColumnId, others)), others),
        );
        const steps = planBoardCardMove({
          board,
          resolved,
          threadId: thread.id,
          archived,
          toColumnId,
          index,
        });
        for (const step of steps) {
          if (step.type === "place") yield* ops.place(step);
          else yield* ops.setArchived(step.threadId, step.type === "archive");
        }
        if (fromColumnId !== toColumnId) {
          if (toColumnId === layout.sendColumnId) {
            yield* ops
              .sendBank(thread.id)
              .pipe(Effect.mapError((error) => fail(`The card moved. ${error.message}`)));
          }
          if (fromColumnId === layout.liveColumnId) yield* ops.stopLiveEnvironment(thread.id);
        }
        return { columnId: toColumnId, index };
      });

    return ProjectBoardService.of({
      read,
      moveCard: (input) =>
        move({
          threadId: input.threadId,
          columnId: input.columnId,
          index: () => input.index ?? 0,
        }).pipe(moves.withPermits(1)),
      placeNewCard: (input) =>
        move({ threadId: input.threadId, columnId: input.columnId, index: newBoardCardIndex }).pipe(
          moves.withPermits(1),
        ),
    });
  });

import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@supaterm/client-runtime/environment";
import { threadRuntimeCanArchive } from "@supaterm/client-runtime/state/models";
import { planBoardMove, type BoardMoveCard } from "@supaterm/client-runtime/state/project-board";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  type EnvironmentProject,
  type EnvironmentThreadShell,
  presentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type BoardColumnId,
  BoardColumnId as BoardColumnIdSchema,
  type EnvironmentId,
  type ProjectBoard as ProjectBoardLayout,
  type ProjectBoardFlag,
  type ProjectId,
  type ScopedProjectRef,
  ThreadId,
  validateProjectBoard,
} from "@supaterm/contracts";
import { newBoardCardIndex, resolveBoardColumns } from "@supaterm/shared/projectBoard";
import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useAtomValue } from "@effect/atom-react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { KanbanIcon, PlusIcon, SquarePenIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useThreadActions } from "../../hooks/useThreadActions";
import { resolveShortcutCommand } from "../../keybindings";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { randomUUID } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import {
  useAllEnvironmentShellsBootstrapped,
  useProject,
  useServerConfigs,
  useThreadShell,
  useThreadShellsForProjectRefs,
} from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useAtomCommand } from "../../state/use-atom-command";
import { liveEnvironment } from "../../state/liveEnvironment";
import { isSidebarSubagentThread } from "../Sidebar.logic";
import { SidebarPointerSensor } from "../Sidebar.pointer";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ProjectWorkspace } from "../workspace/ProjectWorkspace";
import { WorkspaceControls } from "../workspace/WorkspaceControls";
import { BoardPeek } from "./BoardPeek";
import { ProjectTabsBar, useProjectTabsMode, useShowProjectTab } from "../projects/ProjectTabs";
import { cardSummaryText } from "../progress/cardProgress.logic";
import { ProgressViewer } from "../progress/ProgressViewer";
import { useProjectThreadProgress, useThreadProgressSupported } from "../progress/progressState";
import { SummaryDialog } from "../progress/SummaryDialog";
import { threadProgress } from "../../state/threadProgress";
import { BoardCardOverlay, type BoardCardHandlers } from "./BoardCard";
import { BoardColumn } from "./BoardColumn";
import { NewBoardCard } from "./NewBoardCard";
import { useCreateBoardCard } from "./useCreateBoardCard";
import {
  addBoardColumn,
  boardCardFromText,
  type BoardFocusKey,
  type BoardLayout,
  boardColumnDeleteBlocker,
  boardOrDefault,
  canSetBoardColumnFlag,
  deleteBoardColumn,
  findBoardCard,
  moveBoardCard,
  moveBoardColumn,
  nextBoardFocus,
  nudgeBoardCard,
  renameBoardColumn,
  setBoardColumnFlag,
} from "./boardLogic";
import { useOpenThreadFromBoard } from "./boardNavigation";
import { readBoardView, useBoardViewField, useBoardViewStore } from "./boardViewStore";
import { useProjectLiveEnvironments } from "./liveEnvironmentState";
import { useProjectThreadBanks } from "../chat/threadBankState";
import { threadBank } from "../../state/threadBank";

const route = getRouteApi("/_chat/board/$environmentId/$projectId");

/** Archived cards render in pages so a long archive never builds one huge list. */
const DONE_PAGE_SIZE = 50;
const BOARD_DRAG_DISTANCE = 4;
/** How long a drop may wait for the server's echo before the board shows canonical state. */
const PENDING_MOVE_TIMEOUT_MS = 5_000;

const FOCUS_KEYS: Readonly<Record<string, BoardFocusKey>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
};

const MOVE_COMMANDS = {
  "board.card.moveUp": "up",
  "board.card.moveDown": "down",
  "board.card.moveLeft": "left",
  "board.card.moveRight": "right",
} as const;

function failureToast(title: string, result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

function infoToast(title: string, description: string) {
  toastManager.add(stackedThreadToast({ type: "info", title, description }));
}

/** Prefers cards in the column under the pointer, then the column itself. */
const boardCollisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const cards = within.filter((entry) => !String(entry.id).startsWith("column:"));
  if (cards.length > 0) return cards;
  if (within.length > 0) return within;
  return rectIntersection(args);
};

function columnOfCard(layout: BoardLayout, id: string): BoardColumnId | null {
  const position = findBoardCard(layout, id);
  return position === null ? null : layout[position.columnIndex]!.columnId;
}

/** The column a drag is over: a column's own drop zone, or the column of the card under it. */
function overColumnId(layout: BoardLayout, overId: string): BoardColumnId | null {
  if (overId.startsWith("column:")) {
    const columnId = overId.slice("column:".length);
    return layout.find((column) => column.columnId === columnId)?.columnId ?? null;
  }
  return columnOfCard(layout, overId);
}

/** Clicks that land on the board itself, not a card, control, or field. */
const BOARD_INTERACTIVE_SELECTOR =
  "[data-board-card-id], button, a, input, textarea, select, label, [role='menu'], [role='menuitem'], [role='dialog'], [contenteditable='true']";

function isBoardBackground(target: EventTarget): boolean {
  return target instanceof Element && target.closest(BOARD_INTERACTIVE_SELECTOR) === null;
}

export function ProjectBoardPage() {
  const params = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const peekedCardId = search.peek ?? null;
  const peekThreadRef = useMemo(
    () =>
      peekedCardId === null
        ? null
        : scopeThreadRef(params.environmentId as EnvironmentId, peekedCardId as ThreadId),
    [params.environmentId, peekedCardId],
  );
  const peekedThread = useThreadShell(peekThreadRef);
  // Switching peeks replaces the entry, so Back closes the peek in one step.
  const peek = useCallback(
    (threadId: string) =>
      void navigate({ search: { peek: threadId }, replace: peekedCardId !== null }),
    [navigate, peekedCardId],
  );
  const closePeek = useCallback(() => void navigate({ search: {}, replace: true }), [navigate]);
  const projectRef = useMemo(
    () => scopeProjectRef(params.environmentId as EnvironmentId, params.projectId as ProjectId),
    [params.environmentId, params.projectId],
  );
  const project = useProject(projectRef);
  const serverConfigs = useServerConfigs();
  const config = serverConfigs.get(projectRef.environmentId);
  const supported = config?.environment.capabilities.projectBoard === true;
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const canOperate = useEnvironmentScope(projectRef.environmentId, AuthOrchestrationOperateScope);
  const handleNewThread = useNewThreadHandler();
  const tabsMode = useProjectTabsMode();
  const tab = useMemo(
    () => ({ environmentId: params.environmentId, projectId: params.projectId }),
    [params.environmentId, params.projectId],
  );
  useShowProjectTab(tabsMode && project ? tab : null);

  let body: ReactNode;
  if (project && supported) {
    body = (
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* The peek is a glance: a click on empty board dismisses it. */}
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          onClick={
            peekedCardId === null
              ? undefined
              : (event) => {
                  if (isBoardBackground(event.target)) closePeek();
                }
          }
        >
          <ProjectWorkspace
            projectRef={projectRef}
            project={project}
            kanban={
              <ProjectBoardView
                key={scopedProjectKey(projectRef)}
                projectRef={projectRef}
                project={project}
                canOperate={canOperate}
                peekedCardId={peekedThread === null ? null : peekedCardId}
                onPeek={peek}
              />
            }
          />
        </div>
        {peekThreadRef !== null &&
        peekedThread !== null &&
        peekedThread.projectId === project.id ? (
          <BoardPeek threadRef={peekThreadRef} projectId={project.id} onClose={closePeek} />
        ) : null}
      </div>
    );
  } else if (!bootstrapped || (project && config === undefined)) {
    body = null;
  } else {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KanbanIcon />
          </EmptyMedia>
          <EmptyTitle>{project ? "Boards aren't available here" : "Project not found"}</EmptyTitle>
          <EmptyDescription>
            {project
              ? "Update this environment's server to arrange its threads on a board."
              : "This project was removed or its environment is not connected."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          {tabsMode ? (
            <ProjectTabsBar active={tab} />
          ) : (
            <WorkspaceBreadcrumb ariaLabel="Board breadcrumb" className="min-w-0 flex-1">
              <WorkspaceBreadcrumbItem>
                <Link to="/projects" className="hover:text-foreground">
                  Projects
                </Link>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
              {project ? (
                <>
                  <WorkspaceBreadcrumbItem className="min-w-0 shrink">
                    <span className="truncate">{project.title}</span>
                  </WorkspaceBreadcrumbItem>
                  <WorkspaceBreadcrumbSeparator />
                </>
              ) : null}
              <WorkspaceBreadcrumbItem current>
                <h1>Board</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
          )}
          {project && supported ? (
            <WorkspaceControls projectRef={projectRef} project={project} />
          ) : null}
          {project && supported && canOperate ? (
            <Button size="sm" variant="outline" onClick={() => void handleNewThread(projectRef)}>
              <SquarePenIcon />
              New thread
            </Button>
          ) : null}
        </WorkspacePageHeader>
        {body}
      </div>
    </SidebarInset>
  );
}

interface PendingMove {
  readonly layout: BoardLayout;
  /** Threads as they were at the drop, for cards missing from both lists meanwhile. */
  readonly threads: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly cardId: string;
  readonly toColumnId: BoardColumnId;
  readonly settled: boolean;
}

function ProjectBoardView({
  projectRef,
  project,
  canOperate,
  peekedCardId,
  onPeek,
}: {
  projectRef: ScopedProjectRef;
  project: EnvironmentProject;
  canOperate: boolean;
  peekedCardId: string | null;
  onPeek: (threadId: string) => void;
}) {
  const viewKey = scopedProjectKey(projectRef);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openThreadFromBoard = useOpenThreadFromBoard();
  const { archiveThread, unarchiveThread } = useThreadActions();
  const placeOnBoard = useOrchestrationCommand(threadEnvironment.placeOnBoard);
  const liveEnvironments = useProjectLiveEnvironments(projectRef).byThreadId;
  const stopLiveEnvironment = useAtomCommand(liveEnvironment.stop, { reportFailure: false });
  const threadBanks = useProjectThreadBanks(projectRef.environmentId, projectRef.projectId);
  const bankedCounts = useMemo(
    () => new Map([...threadBanks].map(([threadId, entries]) => [threadId, entries.length])),
    [threadBanks],
  );
  const sendThreadBank = useAtomCommand(threadBank.send, { reportFailure: false });
  const progressSupported = useThreadProgressSupported(projectRef.environmentId);
  const progressByThread = useProjectThreadProgress(projectRef.environmentId, projectRef.projectId);
  const captureProgress = useAtomCommand(threadProgress.capture);
  const [viewingProgressId, setViewingProgressId] = useState<string | null>(null);
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);
  const setThreadSummary = useAtomCommand(threadProgress.setSummary);
  const createBoardCard = useCreateBoardCard(project);
  const [addingCardColumnId, setAddingCardColumnId] = useState<BoardColumnId | null>(null);
  const updateProject = useOrchestrationCommand(projectEnvironment.update);

  // ── Board layout, with the last edit shown until the server echoes it ──
  const serverBoard = project.board ?? null;
  const [boardEdit, setBoardEdit] = useState<{
    readonly base: ProjectBoardLayout | null;
    readonly board: ProjectBoardLayout;
  } | null>(null);
  const storedBoard =
    boardEdit !== null && boardEdit.base === serverBoard ? boardEdit.board : serverBoard;
  const board = boardOrDefault(storedBoard);
  const [renamingColumnId, setRenamingColumnId] = useState<BoardColumnId | null>(null);

  const commitBoard = useCallback(
    async (next: ProjectBoardLayout | null) => {
      if (next === null) return;
      const issues = validateProjectBoard(next);
      if (issues.length > 0) {
        infoToast("Couldn't update the board", "That change would leave the board invalid.");
        return;
      }
      setBoardEdit({ base: serverBoard, board: next });
      const result = await updateProject({
        environmentId: projectRef.environmentId,
        input: { projectId: projectRef.projectId, board: next },
      });
      if (result._tag === "Failure") setBoardEdit(null);
    },
    [projectRef, serverBoard, updateProject],
  );

  // ── Threads: live ones always, archived ones once Done was opened ──
  const projectRefs = useMemo(() => [projectRef], [projectRef]);
  const liveThreads = useThreadShellsForProjectRefs(projectRefs);
  const doneExpanded = useBoardViewField(viewKey, "doneExpanded");
  const archiveRequested = useBoardViewField(viewKey, "archiveRequested");
  const updateView = useBoardViewStore((state) => state.update);
  const setColumnScrollTop = useBoardViewStore((state) => state.setColumnScrollTop);
  const archiveEnvironmentIds = useMemo(
    () => (archiveRequested ? [projectRef.environmentId] : []),
    [archiveRequested, projectRef.environmentId],
  );
  const archive = useArchivedThreadSnapshots(archiveEnvironmentIds);
  const threads = useMemo(() => {
    const byId = new Map<string, EnvironmentThreadShell>();
    for (const { environmentId, snapshot } of archive.snapshots) {
      if (environmentId !== projectRef.environmentId) continue;
      for (const thread of snapshot.threads) {
        if (thread.projectId !== projectRef.projectId) continue;
        const shell = presentThreadShell(environmentId, thread);
        if (shell.deletedAt === null && !isSidebarSubagentThread(shell)) byId.set(shell.id, shell);
      }
    }
    // Live shells win: they carry the newest state of a thread just unarchived.
    for (const thread of liveThreads) {
      if (thread.deletedAt === null && !isSidebarSubagentThread(thread)) {
        byId.set(thread.id, thread);
      }
    }
    return [...byId.values()];
  }, [archive.snapshots, liveThreads, projectRef]);

  const resolved = useMemo(() => resolveBoardColumns(storedBoard, threads), [storedBoard, threads]);
  const { canonicalThreadById, orderKeyById, canonicalLayout } = useMemo(() => {
    const byId = new Map<string, EnvironmentThreadShell>();
    const keys = new Map<string, string | null>();
    for (const column of resolved) {
      for (const card of column.cards) {
        byId.set(card.thread.id, card.thread);
        keys.set(card.thread.id, card.orderKey);
      }
    }
    const layout: BoardLayout = resolved.map((column) => ({
      columnId: column.column.id,
      cardIds: column.cards.map((card) => card.thread.id),
    }));
    return { canonicalThreadById: byId, orderKeyById: keys, canonicalLayout: layout };
  }, [resolved]);

  // ── In-flight moves ──
  // A drop shows its result until the server's state agrees, even while an
  // archived or unarchived thread briefly leaves both thread lists.
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const pendingLanded = useMemo(() => {
    if (pendingMove === null || !pendingMove.settled) return false;
    const { cardId, toColumnId } = pendingMove;
    const canonicalIds =
      canonicalLayout.find((column) => column.columnId === toColumnId)?.cardIds ?? [];
    if (!canonicalIds.includes(cardId)) {
      // An archived card stays out of view until the archive is loaded.
      return toColumnId === board.doneColumnId && findBoardCard(canonicalLayout, cardId) === null;
    }
    // Landed once the cards both views share sit in the dropped order.
    const pendingIds =
      pendingMove.layout.find((column) => column.columnId === toColumnId)?.cardIds ?? [];
    const pendingSet = new Set(pendingIds);
    const canonicalSet = new Set(canonicalIds);
    const expected = pendingIds.filter((id) => canonicalSet.has(id));
    const actual = canonicalIds.filter((id) => pendingSet.has(id));
    return expected.every((id, index) => actual[index] === id);
  }, [board.doneColumnId, canonicalLayout, pendingMove]);
  const activePending = pendingLanded ? null : pendingMove;
  useEffect(() => {
    if (pendingMove === null || !pendingMove.settled) return;
    const timeout = setTimeout(
      () => setPendingMove((current) => (current === pendingMove ? null : current)),
      pendingLanded ? 0 : PENDING_MOVE_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [pendingLanded, pendingMove]);
  const moveInFlight = activePending !== null && !activePending.settled;
  const threadById = useMemo(
    () =>
      activePending === null
        ? canonicalThreadById
        : new Map([...activePending.threads, ...canonicalThreadById]),
    [activePending, canonicalThreadById],
  );

  // ── Drag state ──
  const [dragLayout, setDragLayout] = useState<BoardLayout | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const dragFromColumnRef = useRef<BoardColumnId | null>(null);

  const fullLayout = dragLayout ?? activePending?.layout ?? canonicalLayout;
  const [donePageCount, setDonePageCount] = useState(1);
  const visibleLayout = useMemo<BoardLayout>(
    () =>
      fullLayout.map((column) =>
        column.columnId !== board.doneColumnId
          ? column
          : {
              ...column,
              cardIds: doneExpanded ? column.cardIds.slice(0, DONE_PAGE_SIZE * donePageCount) : [],
            },
      ),
    [board.doneColumnId, doneExpanded, donePageCount, fullLayout],
  );

  /** Puts back the Done cards the view hides, after the visible ones. */
  const withHiddenCards = useCallback(
    (layout: BoardLayout): BoardLayout =>
      layout.map((column) => {
        if (column.columnId !== board.doneColumnId) return column;
        const placed = new Set(layout.flatMap((entry) => entry.cardIds));
        const hidden =
          canonicalLayout
            .find((entry) => entry.columnId === column.columnId)
            ?.cardIds.filter((id) => !placed.has(id)) ?? [];
        return { ...column, cardIds: [...column.cardIds, ...hidden] };
      }),
    [board.doneColumnId, canonicalLayout],
  );

  const commitMove = useCallback(
    async (
      cardId: string,
      fromColumnId: BoardColumnId,
      toColumnId: BoardColumnId,
      after: BoardLayout,
    ) => {
      const thread = threadById.get(cardId);
      if (!thread || !canOperate) return;
      const archived = thread.archivedAt !== null;
      if (
        toColumnId === board.doneColumnId &&
        !archived &&
        !threadRuntimeCanArchive(thread.runtime)
      ) {
        infoToast("Thread is still working", "Stop the thread before moving it to Done.");
        return;
      }
      const layout = withHiddenCards(after);
      const targetIds = layout.find((column) => column.columnId === toColumnId)?.cardIds ?? [];
      const targetCards = targetIds.flatMap((id): BoardMoveCard[] => {
        const card = threadById.get(id);
        return card
          ? [
              {
                threadId: card.id,
                orderKey: orderKeyById.get(id) ?? null,
                placement: card.board ?? null,
              },
            ]
          : [];
      });
      const steps = planBoardMove({
        board: storedBoard,
        threadId: thread.id,
        archived,
        fromColumnId,
        toColumnId,
        targetCards,
      });
      if (steps.length === 0) return;
      setPendingMove({ layout, threads: threadById, cardId, toColumnId, settled: false });
      for (const step of steps) {
        const threadRef = scopeThreadRef(projectRef.environmentId, step.threadId);
        if (step.type === "place") {
          const result = await placeOnBoard({
            environmentId: projectRef.environmentId,
            input: {
              threadId: step.threadId,
              columnId: step.columnId,
              orderKey: step.orderKey,
              returnColumnId: step.returnColumnId,
            },
          });
          if (result._tag === "Failure") {
            setPendingMove(null);
            return;
          }
        } else {
          const result =
            step.type === "archive"
              ? await archiveThread(threadRef)
              : await unarchiveThread(threadRef);
          if (result._tag === "Failure") {
            setPendingMove(null);
            if (!isAtomCommandInterrupted(result)) {
              failureToast(
                step.type === "archive" ? "Failed to archive thread" : "Failed to unarchive thread",
                result,
              );
            }
            return;
          }
        }
      }
      setPendingMove((current) =>
        current?.cardId === cardId ? { ...current, settled: true } : current,
      );
      // Entering the send column delivers the card's banked messages as one message.
      if (
        board.sendColumnId != null &&
        toColumnId === board.sendColumnId &&
        fromColumnId !== toColumnId &&
        (bankedCounts.get(thread.id) ?? 0) > 0
      ) {
        void sendThreadBank({
          environmentId: projectRef.environmentId,
          input: { threadId: thread.id },
        }).then((result) => {
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            failureToast("Couldn't send the banked messages", result);
          }
        });
      }
      // Leaving the live preview column ends the card's environment without a warm period.
      if (
        fromColumnId === board.liveColumnId &&
        toColumnId !== fromColumnId &&
        liveEnvironments.has(thread.id)
      ) {
        void stopLiveEnvironment({
          environmentId: projectRef.environmentId,
          input: { threadId: thread.id },
        });
      }
    },
    [
      archiveThread,
      bankedCounts,
      board.sendColumnId,
      sendThreadBank,
      board.liveColumnId,
      liveEnvironments,
      stopLiveEnvironment,
      board.doneColumnId,
      canOperate,
      orderKeyById,
      placeOnBoard,
      projectRef.environmentId,
      storedBoard,
      threadById,
      unarchiveThread,
      withHiddenCards,
    ],
  );

  // ── Cards made in place ──
  const addCard = useCallback(
    async (columnId: BoardColumnId, text: string): Promise<boolean> => {
      const card = boardCardFromText(text);
      if (card === null || !canOperate) return false;
      const created = await createBoardCard({ title: card.title, draft: text.trim() });
      if (created._tag === "no-model") {
        infoToast("Can't add a card yet", "Turn on a provider in Settings first.");
        return false;
      }
      if (created._tag === "failed") {
        if (created.message !== null) infoToast("Couldn't add the card", created.message);
        return false;
      }
      const { threadId } = created;
      const column = fullLayout.find((entry) => entry.columnId === columnId)?.cardIds ?? [];
      const index = newBoardCardIndex(board, columnId, column.length);
      const cardIds = [...column.slice(0, index), threadId, ...column.slice(index)];
      const layout = fullLayout.map((entry) =>
        entry.columnId === columnId ? { ...entry, cardIds } : entry,
      );
      const steps = planBoardMove({
        board: storedBoard,
        threadId,
        archived: false,
        // A new thread starts unplaced, which resolves to the inbox.
        fromColumnId: board.inboxColumnId,
        toColumnId: columnId,
        targetCards: cardIds.flatMap((id): BoardMoveCard[] => {
          if (id === threadId) return [{ threadId, orderKey: null, placement: null }];
          const thread = threadById.get(id);
          return thread
            ? [
                {
                  threadId: thread.id,
                  orderKey: orderKeyById.get(id) ?? null,
                  placement: thread.board ?? null,
                },
              ]
            : [];
        }),
      });
      // The card shows in its column as soon as the thread arrives, not in the inbox first.
      setPendingMove({
        layout,
        threads: threadById,
        cardId: threadId,
        toColumnId: columnId,
        settled: false,
      });
      for (const step of steps) {
        if (step.type !== "place") continue;
        const result = await placeOnBoard({
          environmentId: projectRef.environmentId,
          input: {
            threadId: step.threadId,
            columnId: step.columnId,
            orderKey: step.orderKey,
            returnColumnId: step.returnColumnId,
          },
        });
        if (result._tag === "Failure") break;
      }
      setPendingMove((current) =>
        current?.cardId === threadId ? { ...current, settled: true } : current,
      );
      if (card.summary !== null && progressSupported) {
        void setThreadSummary({
          environmentId: projectRef.environmentId,
          input: { threadId, text: card.summary },
        });
      }
      return true;
    },
    [
      board,
      canOperate,
      createBoardCard,
      fullLayout,
      orderKeyById,
      placeOnBoard,
      progressSupported,
      projectRef.environmentId,
      setThreadSummary,
      storedBoard,
      threadById,
    ],
  );

  // ── Pointer drag ──
  const dragSensorRef = useRef<SidebarPointerSensor | null>(null);
  const sensors = useSensors(
    useSensor(SidebarPointerSensor, {
      distance: BOARD_DRAG_DISTANCE,
      onAttach: (sensor: SidebarPointerSensor) => {
        dragSensorRef.current = sensor;
      },
      onFinish: () => {
        dragSensorRef.current = null;
      },
    }),
  );
  useEffect(() => () => dragSensorRef.current?.cancel(), []);

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    dragFromColumnRef.current = columnOfCard(visibleLayout, id);
    setActiveCardId(id);
    setDragLayout(visibleLayout);
  };
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (over === null) return;
    setDragLayout((layout) => {
      if (layout === null) return layout;
      const id = String(active.id);
      const from = columnOfCard(layout, id);
      const to = overColumnId(layout, String(over.id));
      if (from === null || to === null || from === to) return layout;
      const target = layout.find((column) => column.columnId === to)!;
      const overIndex = target.cardIds.indexOf(String(over.id));
      return moveBoardCard(layout, id, to, overIndex === -1 ? target.cardIds.length : overIndex);
    });
  };
  // A drag ends with a click on the card it moved; that click is not a peek.
  const dragEndedAtRef = useRef(0);
  const endDrag = () => {
    setDragLayout(null);
    setActiveCardId(null);
    dragFromColumnRef.current = null;
    dragEndedAtRef.current = performance.now();
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const layout = dragLayout;
    const fromColumnId = dragFromColumnRef.current;
    endDrag();
    if (layout === null || over === null || fromColumnId === null) return;
    const id = String(active.id);
    const toColumnId = columnOfCard(layout, id);
    if (toColumnId === null) return;
    const overIndex = layout
      .find((column) => column.columnId === toColumnId)!
      .cardIds.indexOf(String(over.id));
    const final = overIndex === -1 ? layout : moveBoardCard(layout, id, toColumnId, overIndex);
    void commitMove(id, fromColumnId, toColumnId, final);
  };

  // ── Focus and keyboard ──
  const boardRef = useRef<HTMLDivElement | null>(null);
  const focusedCardId = useBoardViewField(viewKey, "focusedCardId");
  const tabbableCardId =
    focusedCardId !== null && findBoardCard(visibleLayout, focusedCardId) !== null
      ? focusedCardId
      : nextBoardFocus(visibleLayout, null, "down");
  const focusCard = useCallback((id: string | null) => {
    if (id === null) return;
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-board-card-id="${CSS.escape(id)}"]`)
      ?.focus();
  }, []);

  const openCard = useCallback(
    (id: string) => {
      const thread = threadById.get(id);
      if (!thread) return;
      updateView(viewKey, { focusedCardId: id });
      openThreadFromBoard(scopeThreadRef(thread.environmentId, thread.id), thread.projectId);
    },
    [openThreadFromBoard, threadById, updateView, viewKey],
  );

  const moveCardToColumn = useCallback(
    (id: string, toColumnId: BoardColumnId) => {
      const fromColumnId = columnOfCard(visibleLayout, id);
      if (fromColumnId === null || fromColumnId === toColumnId || moveInFlight) return;
      void commitMove(
        id,
        fromColumnId,
        toColumnId,
        moveBoardCard(visibleLayout, id, toColumnId, 0),
      );
    },
    [commitMove, moveInFlight, visibleLayout],
  );

  const showCardMenu = useCallback(
    async (id: string, position: { x: number; y: number }) => {
      const api = readLocalApi();
      const thread = threadById.get(id);
      if (!api || !thread) return;
      const currentColumnId = columnOfCard(visibleLayout, id);
      const live = liveEnvironments.get(id);
      const hasProgress = (progressByThread.get(id)?.updates.length ?? 0) > 0;
      const clicked = await api.contextMenu.show(
        [
          { id: "open", label: "Open thread" },
          ...(hasProgress ? [{ id: "progress", label: "View progress" }] : []),
          ...(canOperate && progressSupported
            ? [
                ...(live?.status === "ready"
                  ? [{ id: "capture", label: "Capture progress now" }]
                  : []),
                { id: "summary", label: "Edit summary…" },
              ]
            : []),
          ...(canOperate
            ? [
                {
                  id: "move",
                  label: "Move to",
                  disabled: moveInFlight,
                  children: board.columns.map((column) => ({
                    id: `move:${column.id}`,
                    label: column.title,
                    checked: column.id === currentColumnId,
                    disabled: column.id === currentColumnId,
                  })),
                },
              ]
            : []),
        ],
        position,
      );
      if (clicked === "open") openCard(id);
      else if (clicked === "progress") setViewingProgressId(id);
      else if (clicked === "summary") setEditingSummaryId(id);
      else if (clicked === "capture") {
        void captureProgress({
          environmentId: projectRef.environmentId,
          input: { threadId: ThreadId.make(id) },
        });
      } else if (clicked?.startsWith("move:")) {
        moveCardToColumn(id, BoardColumnIdSchema.make(clicked.slice("move:".length)));
      }
    },
    [
      board.columns,
      canOperate,
      captureProgress,
      liveEnvironments,
      moveCardToColumn,
      moveInFlight,
      openCard,
      progressByThread,
      progressSupported,
      projectRef.environmentId,
      threadById,
      visibleLayout,
    ],
  );

  const onCardKeyDown = useCallback(
    (id: string, event: KeyboardEvent<HTMLElement>) => {
      const command = resolveShortcutCommand(event.nativeEvent, keybindings, {
        context: { boardCardFocus: true },
      });
      if (command !== null && command in MOVE_COMMANDS) {
        event.preventDefault();
        event.stopPropagation();
        if (!canOperate || moveInFlight || event.repeat) return;
        const nudge = nudgeBoardCard(
          visibleLayout,
          id,
          MOVE_COMMANDS[command as keyof typeof MOVE_COMMANDS],
        );
        if (nudge === null) return;
        void commitMove(id, nudge.fromColumnId, nudge.toColumnId, nudge.layout);
        // A card moved into a collapsed Done column leaves view; keep focus nearby.
        if (nudge.toColumnId === board.doneColumnId && !doneExpanded) {
          const stay = nextBoardFocus(visibleLayout, id, "down");
          focusCard(stay === id ? nextBoardFocus(visibleLayout, id, "up") : stay);
        } else {
          requestAnimationFrame(() => focusCard(id));
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter") {
        event.preventDefault();
        openCard(id);
        return;
      }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        void showCardMenu(id, { x: rect.left, y: rect.bottom });
        return;
      }
      const key = FOCUS_KEYS[event.key];
      if (key === undefined || event.shiftKey) return;
      event.preventDefault();
      focusCard(nextBoardFocus(visibleLayout, id, key));
    },
    [
      board.doneColumnId,
      canOperate,
      commitMove,
      doneExpanded,
      focusCard,
      keybindings,
      moveInFlight,
      openCard,
      showCardMenu,
      visibleLayout,
    ],
  );

  const handlers = useMemo<BoardCardHandlers>(
    () => ({
      onOpen: openCard,
      onPeek: (id) => {
        if (performance.now() - dragEndedAtRef.current < 250) return;
        updateView(viewKey, { focusedCardId: id });
        onPeek(id);
      },
      onFocusCard: (id) => updateView(viewKey, { focusedCardId: id }),
      onCardKeyDown,
      onCardMenu: (id, position) => void showCardMenu(id, position),
      onViewProgress: setViewingProgressId,
    }),
    [onCardKeyDown, onPeek, openCard, showCardMenu, updateView, viewKey],
  );

  // ── Column editing ──
  const showColumnMenu = useCallback(
    async (columnId: BoardColumnId, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const index = board.columns.findIndex((column) => column.id === columnId);
      const isLive = board.liveColumnId === columnId;
      const isSend = board.sendColumnId === columnId;
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename" },
          { id: "left", label: "Move left", disabled: index <= 0, separatorBefore: true },
          { id: "right", label: "Move right", disabled: index >= board.columns.length - 1 },
          {
            id: "inbox",
            label: "Set as inbox",
            separatorBefore: true,
            disabled: !canSetBoardColumnFlag(board, columnId, "inbox"),
          },
          {
            id: "live",
            label: isLive ? "Turn off live preview" : "Set as live preview",
            disabled: !canSetBoardColumnFlag(board, columnId, "live"),
          },
          {
            id: "send",
            label: isSend ? "Stop sending banked messages" : "Send banked messages here",
            disabled: !canSetBoardColumnFlag(board, columnId, "send"),
          },
          {
            id: "done",
            label: "Set as done",
            disabled: !canSetBoardColumnFlag(board, columnId, "done"),
          },
          { id: "delete", label: "Delete column", destructive: true, separatorBefore: true },
        ],
        position,
      );
      switch (clicked) {
        case "rename":
          setRenamingColumnId(columnId);
          return;
        case "left":
        case "right":
          void commitBoard(moveBoardColumn(board, columnId, clicked));
          return;
        case "inbox":
        case "live":
        case "send":
        case "done":
          void commitBoard(setBoardColumnFlag(board, columnId, clicked satisfies ProjectBoardFlag));
          return;
        case "delete": {
          const blocker = boardColumnDeleteBlocker(board, columnId);
          if (blocker !== null) {
            infoToast("Can't delete this column", DELETE_BLOCKER_MESSAGES[blocker]);
            return;
          }
          const title = board.columns[index]?.title ?? "this column";
          const confirmed = await api.dialogs.confirm(
            `Delete "${title}"? Its cards move to the neighboring column.`,
            { variant: "destructive" },
          );
          if (confirmed) void commitBoard(deleteBoardColumn(board, columnId));
          return;
        }
      }
    },
    [board, commitBoard],
  );

  const onRenameCommit = useCallback(
    (columnId: BoardColumnId, title: string | null) => {
      setRenamingColumnId(null);
      if (title !== null) void commitBoard(renameBoardColumn(board, columnId, title));
    },
    [board, commitBoard],
  );

  const addColumn = () => {
    const id = BoardColumnIdSchema.make(`col-${randomUUID().slice(0, 8)}`);
    const next = addBoardColumn(board, { id, title: "New column" });
    if (next === null) {
      infoToast("Can't add a column", "A board holds at most 20 columns.");
      return;
    }
    void commitBoard(next);
    setRenamingColumnId(id);
  };

  // ── Scroll memory ──
  const onListScroll = useCallback(
    (columnId: BoardColumnId, scrollTop: number) =>
      setColumnScrollTop(viewKey, columnId, scrollTop),
    [setColumnScrollTop, viewKey],
  );
  const restoredRef = useRef(false);
  const hasCards = threads.length > 0;
  useLayoutEffect(() => {
    if (restoredRef.current || !hasCards) return;
    restoredRef.current = true;
    const view = readBoardView(viewKey);
    const root = boardRef.current;
    if (root === null) return;
    root.scrollLeft = view.scrollLeft;
    for (const list of root.querySelectorAll<HTMLElement>("[data-board-column-list]")) {
      list.scrollTop = view.columnScrollTop[list.dataset.boardColumnList ?? ""] ?? 0;
    }
    if (view.focusedCardId !== null) {
      root
        .querySelector<HTMLElement>(`[data-board-card-id="${CSS.escape(view.focusedCardId)}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [hasCards, viewKey]);

  const doneCount =
    canonicalLayout.find((column) => column.columnId === board.doneColumnId)?.cardIds.length ?? 0;
  const toggleDone = () => {
    setDonePageCount(1);
    updateView(viewKey, { doneExpanded: !doneExpanded, archiveRequested: true });
  };
  const archiveCountKnown = archiveRequested && !archive.isLoading;

  const activeThread = activeCardId === null ? null : (threadById.get(activeCardId) ?? null);
  const viewingThread =
    viewingProgressId === null ? null : (threadById.get(viewingProgressId) ?? null);
  const viewingProgress =
    viewingProgressId === null ? undefined : progressByThread.get(viewingProgressId);
  const editingThread =
    editingSummaryId === null ? null : (threadById.get(editingSummaryId) ?? null);

  // Screen readers hear card and column names, not dnd-kit's internal ids.
  const announcements = useMemo<Announcements>(() => {
    const nameOf = (id: string | number) => {
      const thread = threadById.get(String(id));
      if (thread) return thread.title;
      const column = board.columns.find((entry) => String(id).endsWith(entry.id));
      return column ? `${column.title} column` : "the board";
    };
    return {
      onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
      // Sortable reports the card itself as the target once it has moved.
      onDragOver: ({ active, over }) =>
        over && over.id !== active.id
          ? `${nameOf(active.id)} is over ${nameOf(over.id)}.`
          : undefined,
      onDragEnd: ({ active }) => `Dropped ${nameOf(active.id)}.`,
      onDragCancel: ({ active }) => `Stopped moving ${nameOf(active.id)}.`,
    };
  }, [board.columns, threadById]);

  return (
    <DndContext
      accessibility={{ announcements }}
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <div
        ref={boardRef}
        role="group"
        aria-label={`${project.title} board`}
        className="flex min-h-0 flex-1 snap-x snap-proximity items-start gap-3 overflow-x-auto overscroll-x-contain px-4 pt-2 pb-4"
        onScroll={(event) => {
          if (event.target === event.currentTarget) {
            updateView(viewKey, { scrollLeft: event.currentTarget.scrollLeft });
          }
        }}
      >
        {board.columns.map((column) => {
          const isDone = column.id === board.doneColumnId;
          const cardIds =
            visibleLayout.find((entry) => entry.columnId === column.id)?.cardIds ?? [];
          const cards = cardIds.flatMap((id) => {
            const thread = threadById.get(id);
            return thread ? [thread] : [];
          });
          const hiddenDoneCount = isDone && doneExpanded ? doneCount - cards.length : 0;
          return (
            <BoardColumn
              key={column.id}
              column={column}
              flags={{
                inbox: column.id === board.inboxColumnId,
                live: column.id === board.liveColumnId,
                send: column.id === board.sendColumnId,
                done: isDone,
              }}
              cards={cards}
              cardCountLabel={
                isDone ? (archiveCountKnown ? String(doneCount) : "") : String(cards.length)
              }
              liveEnvironments={liveEnvironments}
              bankedCounts={bankedCounts}
              progressByThread={progressByThread}
              tabbableCardId={tabbableCardId}
              peekedCardId={peekedCardId}
              canEdit={canOperate}
              canDrag={canOperate && !moveInFlight}
              renaming={renamingColumnId === column.id}
              collapsedBody={
                isDone && !doneExpanded ? (
                  <li className="list-none">
                    <Button size="sm" variant="ghost" className="w-full" onClick={toggleDone}>
                      {archiveCountKnown ? `Show ${doneCount} archived` : "Show archived"}
                    </Button>
                  </li>
                ) : null
              }
              footer={
                isDone && doneExpanded ? (
                  <div className="flex flex-col gap-1 px-2 pb-2">
                    {archive.isLoading ? (
                      <p className="px-1 text-xs text-muted-foreground">
                        Loading archived threads…
                      </p>
                    ) : null}
                    {archive.error ? (
                      <p className="px-1 text-xs text-destructive-foreground">{archive.error}</p>
                    ) : null}
                    {hiddenDoneCount > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDonePageCount((count) => count + 1)}
                      >
                        Show {Math.min(DONE_PAGE_SIZE, hiddenDoneCount)} more
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={toggleDone}>
                      Hide archived
                    </Button>
                  </div>
                ) : null
              }
              newCard={
                addingCardColumnId === column.id ? (
                  <NewBoardCard
                    columnTitle={column.title}
                    onAdd={(text) => addCard(column.id, text)}
                    onClose={() => setAddingCardColumnId(null)}
                  />
                ) : null
              }
              onAddCard={canOperate && !isDone ? () => setAddingCardColumnId(column.id) : null}
              handlers={handlers}
              onRenameCommit={onRenameCommit}
              onStartRename={setRenamingColumnId}
              onColumnMenu={(columnId, position) => void showColumnMenu(columnId, position)}
              onListScroll={onListScroll}
            />
          );
        })}
        {canOperate ? (
          <Button variant="ghost" className="shrink-0 snap-start" onClick={addColumn}>
            <PlusIcon />
            Add column
          </Button>
        ) : null}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeThread ? (
          <BoardCardOverlay
            thread={activeThread}
            progress={progressByThread.get(activeThread.id)}
            bankedCount={bankedCounts.get(activeThread.id) ?? 0}
          />
        ) : null}
      </DragOverlay>
      {viewingThread && viewingProgress ? (
        <ProgressViewer
          environmentId={projectRef.environmentId}
          threadRef={scopeThreadRef(projectRef.environmentId, viewingThread.id)}
          title={viewingThread.title}
          progress={viewingProgress}
          latestRunStartedAt={viewingThread.latestRun?.startedAt}
          canCapture={canOperate && liveEnvironments.get(viewingThread.id)?.status === "ready"}
          onOpenChange={(open) => {
            if (!open) setViewingProgressId(null);
          }}
          onReplied={() => onPeek(viewingThread.id)}
        />
      ) : null}
      {editingThread ? (
        <SummaryDialog
          environmentId={projectRef.environmentId}
          threadId={editingThread.id}
          summary={progressByThread.get(editingThread.id)?.summary ?? null}
          fallback={cardSummaryText(
            progressByThread.get(editingThread.id),
            editingThread.goal?.objective,
          )}
          onOpenChange={(open) => {
            if (!open) setEditingSummaryId(null);
          }}
        />
      ) : null}
    </DndContext>
  );
}

const DELETE_BLOCKER_MESSAGES = {
  done: "Done always exists. Set another column as done first.",
  inbox: "New threads land here. Set another column as the inbox first.",
  live: "This is the live preview column. Turn it off or move it first.",
  "min-columns": "A board needs at least two columns.",
} as const;

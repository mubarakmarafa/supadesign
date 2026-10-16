import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectWorkspaceWidget, ServerProvider } from "@supaterm/contracts";
import { formatTokens, formatUsd, makeWindow } from "@supaterm/shared/usageFormat";
import {
  headlineUsageWindows,
  providersWithLimits,
  remainingPercent,
} from "@supaterm/shared/usageLimits";
import { Link } from "@tanstack/react-router";
import { GaugeIcon } from "lucide-react";
import { useMemo } from "react";

import { serverEnvironment } from "../../../state/server";
import { useUsage } from "../../../state/usage";
import { usageFillColor } from "../../chat/ContextWindow.logic";
import { providerClients } from "../../settings/providerDriverMeta";
import { WidgetMessage, WorkspaceWidgetFrame } from "../WorkspaceWidgetFrame";

const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

/**
 * Tokens and spend from the same summaries as the Usage page, plus the plan
 * limits the composer meter shows. Usage is not attributed per project, so the
 * widget says it covers the whole environment.
 */
export function UsageWidget({
  widget,
  environmentId,
}: {
  widget: ProjectWorkspaceWidget;
  environmentId: EnvironmentId;
}) {
  // One week window per mount; today is its last day.
  const window = useMemo(() => makeWindow(7), []);
  const selected = useMemo(() => new Set([environmentId]), [environmentId]);
  const usage = useUsage(window, selected);
  const status = usage.selectedEnvironments[0];
  const merged = usage.shown?.merged ?? usage.merged;
  const today = merged.daily.find((day) => day.day === window.untilDay);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? NO_PROVIDERS;
  const limits = useMemo(
    () =>
      providersWithLimits(providers).flatMap((provider) => {
        const windows = headlineUsageWindows(provider);
        return windows.length === 0
          ? []
          : [
              {
                id: provider.instanceId,
                label:
                  provider.displayName ??
                  providerClients.get(provider.driver)?.label ??
                  String(provider.driver),
                windows,
              },
            ];
      }),
    [providers],
  );

  let body;
  if (status !== undefined && !status.canReadDiagnostics) {
    body = <WidgetMessage>This connection can't read usage.</WidgetMessage>;
  } else if (usage.isPending && usage.shown === null) {
    body = <WidgetMessage>Reading usage…</WidgetMessage>;
  } else {
    const costKnown = merged.totalTokens === 0 || merged.costQuality.unpricedShare < 1;
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
        <dl className="grid grid-cols-2 gap-3">
          <UsageTotal
            label="Today"
            tokens={today?.totalTokens ?? 0}
            costUsd={today?.costUsd ?? 0}
            costKnown={costKnown}
          />
          <UsageTotal
            label="Last 7 days"
            tokens={merged.totalTokens}
            costUsd={merged.costUsd}
            costKnown={costKnown}
          />
        </dl>
        {limits.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Plan limits</h3>
            {limits.map((provider) => (
              <div key={provider.id} className="flex flex-col gap-1">
                <span className="truncate text-xs">{provider.label}</span>
                {provider.windows.map(({ label, window: limit }) => {
                  const remaining = remainingPercent(limit);
                  return (
                    <div
                      key={limit.id}
                      role="meter"
                      aria-label={`${provider.label} ${limit.label}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remaining}
                      className="flex items-center gap-2 text-xs tabular-nums"
                    >
                      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
                      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted-foreground/24">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${remaining}%`,
                            backgroundColor: usageFillColor(100 - remaining),
                          }}
                        />
                      </span>
                      <span className="shrink-0 text-muted-foreground">{remaining}% left</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
        {status?.error ? (
          <p className="text-xs text-destructive-foreground">{status.error}</p>
        ) : null}
        <p className="mt-auto text-xs text-muted-foreground">
          Covers every project on {status?.label ?? "this environment"}.{" "}
          <Link to="/usage" className="underline-offset-4 hover:underline">
            Open Usage
          </Link>
        </p>
      </div>
    );
  }

  return (
    <WorkspaceWidgetFrame widget={widget} title="Usage" icon={<GaugeIcon />}>
      {body}
    </WorkspaceWidgetFrame>
  );
}

function UsageTotal({
  label,
  tokens,
  costUsd,
  costKnown,
}: {
  label: string;
  tokens: number;
  costUsd: number;
  costKnown: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{costKnown ? formatUsd(costUsd) : "—"}</dd>
      <dd className="text-xs text-muted-foreground tabular-nums">{formatTokens(tokens)} tokens</dd>
    </div>
  );
}

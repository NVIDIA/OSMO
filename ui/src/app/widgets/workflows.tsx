import { useMemo } from "react";

import Link from "next/link";

import { getDateFromValues } from "~/components/DateRangePicker";
import { OutlinedIcon } from "~/components/Icon";
import { StatusFilterType } from "~/components/StatusFilter";
import { UserFilterType } from "~/components/UserFilter";
import { WorkflowPieChart } from "~/components/WorkflowPieChart";
import { env } from "~/env.mjs";
import { type WorkflowStatusType } from "~/models";
import { api } from "~/trpc/react";

import { getWorkflowStatusArray } from "../workflows/components/StatusFilter";
import { type WorkflowsFiltersDataProps } from "../workflows/components/WorkflowsFilters";
import useToolParamUpdater from "../workflows/hooks/useToolParamUpdater";

export interface WorkflowWidgetDataProps {
  id: string;
  name: string;
  description?: string;
  filters: WorkflowsFiltersDataProps;
}

export const WorkflowsWidget = ({
  widget,
  onEdit,
  isEditing,
}: {
  widget: WorkflowWidgetDataProps;
  onEdit: (widget: WorkflowWidgetDataProps) => void;
  isEditing: boolean;
}) => {
  const { getUrlParams } = useToolParamUpdater();
  const dateRangeDates = getDateFromValues(
    widget.filters.dateRange,
    widget.filters.submittedAfter,
    widget.filters.submittedBefore,
  );

  const { data: currentWorkflows } = api.workflows.getStatusTotals.useQuery(
    {
      all_users: widget.filters.userType === UserFilterType.ALL,
      users: widget.filters.userType === UserFilterType.CUSTOM ? (widget.filters.selectedUsers?.split(",") ?? []) : [],
      all_pools: widget.filters.isSelectAllPoolsChecked,
      pools: widget.filters.isSelectAllPoolsChecked ? [] : widget.filters.selectedPools.split(","),
      submitted_after: dateRangeDates.fromDate?.toISOString(),
      submitted_before: dateRangeDates.toDate?.toISOString(),
      statuses:
        widget.filters.statusFilterType === StatusFilterType.CUSTOM
          ? (widget.filters.statuses?.split(",") as WorkflowStatusType[])
          : getWorkflowStatusArray(widget.filters.statusFilterType),
      priority: widget.filters.priority,
    },
    {
      refetchOnWindowFocus: true,
      refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000,
    },
  );

  const detailsUrl = useMemo(() => {
    return `/workflows?${getUrlParams(widget.filters, undefined).toString()}`;
  }, [widget, getUrlParams]);

  return (
    <section
      className="card flex flex-col"
      aria-labelledby="current-workflows-title"
    >
      <div className="popup-header body-header">
        <h2 id="current-workflows-title">{widget.name}</h2>
        {isEditing ? (
          <button
            className="btn btn-secondary"
            onClick={() => onEdit(widget)}
            title={`Edit ${widget.name}`}
          >
            <OutlinedIcon name="edit" />
          </button>
        ) : (
          <Link
            href={detailsUrl}
            className="btn btn-secondary"
            title={`View All ${widget.name}`}
          >
            <OutlinedIcon name="list_alt" />
          </Link>
        )}
      </div>
      <div
        className={`flex flex-col gap-global p-global w-full flex-1 justify-between ${isEditing ? "opacity-60" : ""}`}
      >
        <WorkflowPieChart
          counts={currentWorkflows ?? {}}
          size={160}
          innerRadius={40}
          ariaLabel={widget.name}
        />
      </div>
      {widget.description && <p className="text-sm text-center p-global text-gray-500">{widget.description}</p>}
    </section>
  );
};

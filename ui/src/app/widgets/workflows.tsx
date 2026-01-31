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

export interface WorkflowWidgetDataProps extends WorkflowsFiltersDataProps {
  id: string;
  name: string;
  description?: string;
}

export const WorkflowsWidget = ({ filters, onEdit, onDelete, isEditing }: { filters: WorkflowWidgetDataProps, onEdit: (widget: WorkflowWidgetDataProps) => void, onDelete: (widget: WorkflowWidgetDataProps) => void, isEditing: boolean }) => {
  const { getUrlParams } = useToolParamUpdater();
  const dateRangeDates = getDateFromValues(filters.dateRange, filters.submittedAfter, filters.submittedBefore);

  const { data: currentWorkflows } = api.workflows.getStatusTotals.useQuery({
    all_users: filters.userType === UserFilterType.ALL,
    users: filters.userType === UserFilterType.CUSTOM ? (filters.selectedUsers?.split(",") ?? []) : [],
    all_pools: filters.isSelectAllPoolsChecked,
    pools: filters.isSelectAllPoolsChecked ? [] : filters.selectedPools.split(","),
    submitted_after: dateRangeDates.fromDate?.toISOString(),
    submitted_before: dateRangeDates.toDate?.toISOString(),
    statuses:
      filters.statusFilterType === StatusFilterType.CUSTOM
        ? (filters.statuses?.split(",") as WorkflowStatusType[])
        : getWorkflowStatusArray(filters.statusFilterType),
    priority: filters.priority,
  }, {
    refetchOnWindowFocus: true,
    refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000
  });

  const detailsUrl = useMemo(() => {
    return `/workflows?${getUrlParams(filters, undefined).toString()}`;
  }, [filters, getUrlParams]);

  return (
    <section className="card w-100" aria-labelledby="current-workflows-title">
      <div className="popup-header body-header">
        <h2 id="current-workflows-title">{filters.name}</h2>
        {isEditing ? (
          <div className="flex flex-row gap-global">
            <button className="btn btn-secondary" onClick={() => onEdit(filters)}>
              <OutlinedIcon name="edit" />
            </button>
            <button className="btn btn-secondary" onClick={() => onDelete(filters)}>
              <OutlinedIcon name="delete" />
            </button>
          </div>
        ) : (
          <Link href={detailsUrl} className="btn btn-secondary" title="View All Current Workflows">
            <OutlinedIcon name="list_alt" />
          </Link>
        )}
      </div>
      <div className={`flex flex-col gap-global p-global h-70 w-full justify-between ${isEditing ? "opacity-40" : ""}`}>
        <WorkflowPieChart
          counts={currentWorkflows ?? {}}
          size={160}
          innerRadius={40}
          ariaLabel="My Current Workflows"
        />
        {filters.description && <p className="text-sm text-gray-500 text-center">{filters.description}</p>}
      </div>
    </section>
  );
};

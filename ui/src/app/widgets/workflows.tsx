import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { getDateFromValues } from "~/components/DateRangePicker";
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { StatusFilterType } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { UserFilterType } from "~/components/UserFilter";
import { WorkflowPieChart } from "~/components/WorkflowPieChart";
import { env } from "~/env.mjs";
import { type WorkflowStatusType } from "~/models";
import { api } from "~/trpc/react";

import { getWorkflowStatusArray } from "../workflows/components/StatusFilter";
import { WorkflowsFilters, type WorkflowsFiltersDataProps } from "../workflows/components/WorkflowsFilters";
import useToolParamUpdater from "../workflows/hooks/useToolParamUpdater";

export interface WorkflowWidgetDataProps {
  id: string;
  name: string;
  description?: string;
  filters: WorkflowsFiltersDataProps;
}

export const WorkflowsWidget = ({
  widget,
  currentUserName,
  onSave,
  onDelete,
}: {
  widget: WorkflowWidgetDataProps;
  currentUserName: string;
  onSave: (widget: WorkflowWidgetDataProps) => void;
  onDelete: () => void;
}) => {
  const { getUrlParams } = useToolParamUpdater();
  const [isEditing, setIsEditing] = useState(false);
  const [widgetName, setWidgetName] = useState(widget.name);
  const [widgetDescription, setWidgetDescription] = useState(widget.description ?? "");

  useEffect(() => {
    if (widgetName === "") {
      setIsEditing(true);
    }
  }, [widgetName]);

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
    <>
      <section
        className="card flex flex-col"
        aria-labelledby="current-workflows-title"
      >
        <div className="popup-header body-header">
          <h2 id="current-workflows-title">{widget.name}</h2>
          <div className="flex flex-row gap-global">
            <button
              className="btn btn-secondary"
              onClick={() => setIsEditing(true)}
              title={`Edit ${widget.name}`}
            >
              <OutlinedIcon name="edit" />
            </button>
            <Link
              href={detailsUrl}
              className="btn btn-secondary"
              title={`View All ${widget.name}`}
            >
              <OutlinedIcon name="list_alt" />
            </Link>
          </div>
        </div>
        <div
          className="flex flex-col gap-global p-global w-full flex-1 justify-between"
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
      <FullPageModal
        open={isEditing}
        onClose={() => {
          setIsEditing(false);
        }}
        headerChildren={
          <h2 id="edit-header">{widget.name ? "Edit Workflow" : "New Workflow"}</h2>
        }
        aria-labelledby="edit-header"
        size="md"
      >
        <TextInput
          id="widget-name"
          label="Name"
          className="w-full"
          required
          containerClassName="w-full p-global"
          value={widgetName}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setWidgetName(event.target.value);
          }}
          errorText={widgetName === "" ? "Name is required" : undefined}
        />
        <TextInput
          id="widget-description"
          label="Description"
          className="w-full"
          containerClassName="w-full p-global"
          value={widgetDescription}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setWidgetDescription(event.target.value);
          }}
        />
        <WorkflowsFilters
          fields={["user", "date", "status", "pool", "priority"]}
          name={""}
          userType={widget.filters.userType}
          selectedUsers={widget.filters.selectedUsers}
          selectedPools={widget.filters.selectedPools}
          dateRange={widget.filters.dateRange}
          statusFilterType={widget.filters.statusFilterType}
          submittedAfter={widget.filters.submittedAfter}
          submittedBefore={widget.filters.submittedBefore}
          isSelectAllPoolsChecked={widget.filters.isSelectAllPoolsChecked}
          currentUserName={currentUserName}
          priority={widget.filters.priority}
          onSave={(data: WorkflowsFiltersDataProps) => {
            if (!widgetName) {
              return;
            }

            setIsEditing(false);
            onSave({
              id: widget.id,
              name: widgetName,
              description: widgetDescription,
              filters: data,
            })
          }}
          onDelete={onDelete}
          saveButtonText="Save"
          saveButtonIcon="save"
        />
      </FullPageModal>
    </>
  );
};

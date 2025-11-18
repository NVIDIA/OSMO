import { IconButton } from "./IconButton";

export const FilterButton = ({
  showFilters,
  setShowFilters,
  filterCount,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  showFilters: boolean;
  setShowFilters: (showFilters: boolean) => void;
  filterCount: number;
}) => {
  return (
    <IconButton
      icon="filter_list"
      text="Filters"
      aria-expanded={showFilters}
      aria-haspopup="true"
      className={`relative btn ${showFilters ? "btn-primary" : ""}`}
      onClick={() => {
        setShowFilters(!showFilters);
      }}
      {...props}
      aria-label={`Filters${filterCount > 0 ? ` (${filterCount} active filters)` : ""}`}
    >
      {filterCount > 0 && <div className="tag-filter">{filterCount}</div>}
    </IconButton>
  );
};

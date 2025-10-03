import { SHOW_USED_KEY } from "~/components/StoreProvider";
import { ViewToggleButton } from "~/components/ViewToggleButton";

export const UsedFreeToggle = ({
  isShowingUsed,
  updateUrl,
}: {
  isShowingUsed: boolean;
  updateUrl: (url: { isShowingUsed: boolean }) => void;
}) => {
  return (
    <fieldset
      className="flex flex-row gap-3"
      aria-label="View Type"
    >
      <ViewToggleButton
        name="isShowingUsed"
        checked={isShowingUsed}
        onChange={() => {
          updateUrl({ isShowingUsed: true });
          localStorage.setItem(SHOW_USED_KEY, "true");
        }}
      >
        Used
      </ViewToggleButton>
      <ViewToggleButton
        name="isShowingUsed"
        checked={!isShowingUsed}
        onChange={() => {
          updateUrl({ isShowingUsed: false });
          localStorage.setItem(SHOW_USED_KEY, "false");
        }}
      >
        Free
      </ViewToggleButton>
    </fieldset>
  );
};

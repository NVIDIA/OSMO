import Link from "next/link";

import { InlineBanner } from "./InlineBanner";

export const getTaskHistoryUrl = (nodeName: string) => {
  return `/tasks?allUsers=true&allPools=true&nodes=${nodeName}&allNodes=false&statusFilterType=all`;
};

export const TaskHistoryBanner = ({ nodeName }: { nodeName: string }) => {
  return (
    <InlineBanner status="info">
      <p>
        See{" "}
        <Link
          href={getTaskHistoryUrl(nodeName)}
          target="_blank"
          rel="noopener noreferrer"
          className="link-inline"
        >
          Task History
        </Link>{" "}
        on this node
      </p>
    </InlineBanner>
  );
};

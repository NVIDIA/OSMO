import { Shell } from "@/components/shell";

export default function DashboardLayout(props: {
  children: React.ReactNode;
}) {
  return <Shell>{props.children}</Shell>;
}

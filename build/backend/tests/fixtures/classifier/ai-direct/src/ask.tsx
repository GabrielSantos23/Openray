import { LaunchProps, showToast, Toast } from "@raycast/api";
import { AI } from "@raycast/api";

export default async function Command(props: LaunchProps) {
  const answer = await AI.ask("Summarize: " + String(props.fallbackText ?? ""));
  await showToast({ title: answer, style: Toast.Style.Success });
}

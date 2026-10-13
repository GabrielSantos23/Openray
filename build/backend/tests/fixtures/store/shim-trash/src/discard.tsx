import { showToast, Toast, trash, showInFinder } from "@raycast/api";

export default async function Command() {
  try {
    await trash("C:/nonexistent-for-probe.bin");
    await showInFinder("C:/nonexistent-for-probe.bin");
    await showToast({ title: "done", style: Toast.Style.Success });
  } catch (error) {
    await showToast({ title: "failed", message: String(error), style: Toast.Style.Failure });
  }
}

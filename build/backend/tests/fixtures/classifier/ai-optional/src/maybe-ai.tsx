import { environment } from "@raycast/api";
import { AI } from "@raycast/api";

export default async function Command() {
  if (environment.canAccess(AI)) {
    await AI.ask("hello");
  }
}
